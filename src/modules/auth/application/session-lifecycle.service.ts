import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { UserRepository } from '../../users/infrastructure/user.repository';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import type { AuthSessionRecord } from '../domain/auth-session';
import {
  classifyRefreshDigestMismatch,
  remainingSessionSeconds,
} from '../domain/refresh-reuse';
import { AuthSubjectType } from '../domain/subject-type';
import { AuthSessionRepository } from '../infrastructure/auth-session.repository';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import { PushInstallationService } from '../../notifications/application/push-installation.service';

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenMaxAgeSeconds: number;
}

/**
 * Refresh rotation, reuse detection, and logout orchestration.
 * Controllers own cookie I/O; this service stays free of Express types.
 */
@Injectable()
export class SessionLifecycleService {
  private readonly accessTokenTtlSeconds: number;

  constructor(
    private readonly sessions: AuthSessionRepository,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly logger: ApplicationLogger,
    config: ConfigService,
    @Optional()
    @Inject(forwardRef(() => PushInstallationService))
    private readonly installations?: PushInstallationService,
  ) {
    this.accessTokenTtlSeconds = config.getOrThrow<number>(
      'JWT_ACCESS_TTL_SECONDS',
    );
  }

  async refresh(rawRefreshToken: string): Promise<RefreshSessionResult> {
    const now = new Date();
    const parsed = this.refreshTokens.parseRefreshToken(rawRefreshToken);
    const presentedDigest = this.refreshTokens.digest(rawRefreshToken);

    const session = await this.sessions.findSessionById(parsed.sessionId);
    if (session === null) {
      await this.rejectMissingSessionReuse(presentedDigest, now);
      this.logRefreshRejected('session_missing');
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Refresh token is invalid.',
      );
    }

    this.assertSessionRefreshable(session, now);

    if (session.refreshTokenHash !== presentedDigest) {
      await this.handleDigestMismatch(session, presentedDigest, now);
    }

    await this.assertUserActive(session.userId);

    const issuedRefresh = this.refreshTokens.issueRefreshToken(session.id);
    const access = await this.accessTokens.issueAccessToken({
      subjectId: session.userId,
      subjectType: AuthSubjectType.USER,
      sessionId: session.id,
    });

    const rotated = await this.sessions.rotateRefreshTokenHash({
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      currentRefreshTokenHash: presentedDigest,
      newRefreshTokenHash: issuedRefresh.digest,
      now,
      consumptionExpiresAt: session.expiresAt,
    });

    if (rotated === null) {
      const latest = await this.sessions.findSessionById(session.id);
      if (latest === null) {
        this.logRefreshRejected('session_missing_after_rotate');
        throw new AuthError(
          AuthErrorCode.INVALID_TOKEN,
          'Refresh token is invalid.',
        );
      }
      this.assertSessionRefreshable(latest, now);
      await this.handleDigestMismatch(latest, presentedDigest, now);
    }

    // Logout may have revoked after our successful rotate; do not return cookies.
    const postRotate = await this.sessions.findSessionById(session.id);
    if (postRotate === null || postRotate.revokedAt !== null) {
      this.logRefreshRejected('session_revoked_after_rotate', session);
      throw new AuthError(
        AuthErrorCode.SESSION_REVOKED,
        'Session has been revoked.',
      );
    }

    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.refresh.succeeded',
        sessionId: session.id,
        subjectType: AuthSubjectType.USER,
        subjectId: session.userId,
      },
      'Refresh token rotated',
    );

    return {
      accessToken: access.token,
      refreshToken: issuedRefresh.rawToken,
      accessTokenTtlSeconds: this.accessTokenTtlSeconds,
      refreshTokenMaxAgeSeconds: remainingSessionSeconds(
        session.expiresAt,
        now,
      ),
    };
  }

  /**
   * Revokes the caller's current session when a principal is present.
   * Idempotent for customers: already-revoked or missing sessions are not errors.
   *
   * A non-USER principal is answered `AUTH_FORBIDDEN` (403) before any session
   * lookup. Returning success when no customer session exists would hide the
   * wrong-subject contract and invite a browser client to treat logout as ok
   * while the access token remains valid until expiry.
   */
  async logoutCurrent(
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<void> {
    const now = new Date();
    if (principal === undefined) {
      return;
    }
    if (principal.subjectType !== AuthSubjectType.USER) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const session = await this.sessions.findSessionById(principal.sessionId);
    if (session === null) {
      return;
    }
    if (session.userId !== principal.subjectId) {
      // Authenticated USER acting on a session it does not own.
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const revoked = await this.sessions.revokeSession(session.id, now);
    if (revoked) {
      this.logger.info(
        {
          module: 'auth',
          operation: 'auth.session.revoked',
          sessionId: session.id,
          subjectType: principal.subjectType,
          subjectId: principal.subjectId,
          scope: 'current',
        },
        'Auth session revoked',
      );
    }
  }

  /**
   * Revokes all unrevoked sessions for the authenticated subject.
   *
   * `AuthSession` holds customer sessions only, so a non-USER subject has
   * nothing to revoke here. It is answered `AUTH_FORBIDDEN` (403) rather than
   * 401: the caller is authenticated, and 401 would invite a browser client to
   * refresh and retry indefinitely. Admin session revocation arrives with Admin
   * session persistence.
   */
  async logoutAll(principal: AuthenticatedPrincipal): Promise<void> {
    if (principal.subjectType !== AuthSubjectType.USER) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const now = new Date();
    const count = await this.sessions.revokeAllUserSessions(
      principal.subjectId,
      now,
    );
    const installationCount =
      this.installations === undefined
        ? 0
        : await this.installations.revokeAll(principal.subjectId);

    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.sessions.revoked_all',
        subjectType: principal.subjectType,
        subjectId: principal.subjectId,
        revokedCount: count,
        installationCount,
      },
      'All auth sessions revoked for subject',
    );
  }

  private assertSessionRefreshable(
    session: AuthSessionRecord,
    now: Date,
  ): void {
    if (session.revokedAt !== null) {
      this.logRefreshRejected('session_revoked', session);
      throw new AuthError(
        AuthErrorCode.SESSION_REVOKED,
        'Session has been revoked.',
      );
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      this.logRefreshRejected('session_expired', session);
      throw new AuthError(
        AuthErrorCode.SESSION_EXPIRED,
        'Session has expired.',
      );
    }
  }

  private async assertUserActive(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user === null || !user.isActive) {
      this.logRefreshRejected('account_disabled');
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }
  }

  private async handleDigestMismatch(
    session: AuthSessionRecord,
    presentedDigest: string,
    now: Date,
  ): Promise<never> {
    const consumed =
      await this.sessions.findConsumedRefreshTokenByHash(presentedDigest);
    const classification = classifyRefreshDigestMismatch({
      sessionFamilyId: session.tokenFamilyId,
      consumed,
      nowMs: Date.now(),
    });

    if (classification.kind === 'lost_race') {
      this.logRefreshRejected('concurrent_refresh_race', session);
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Refresh token is invalid.',
      );
    }

    if (classification.kind === 'confirmed_reuse') {
      await this.sessions.revokeSessionsByTokenFamily(
        session.tokenFamilyId,
        now,
      );
      this.logger.warn(
        {
          module: 'auth',
          operation: 'auth.refresh.reuse_detected',
          sessionId: session.id,
          tokenFamilyId: session.tokenFamilyId,
          subjectId: session.userId,
          subjectType: AuthSubjectType.USER,
        },
        'Refresh token reuse detected; token family revoked',
      );
      throw new AuthError(
        AuthErrorCode.REFRESH_TOKEN_REUSED,
        'Refresh token reuse detected.',
      );
    }

    this.logRefreshRejected('digest_mismatch', session);
    throw new AuthError(
      AuthErrorCode.INVALID_TOKEN,
      'Refresh token is invalid.',
    );
  }

  private async rejectMissingSessionReuse(
    presentedDigest: string,
    now: Date,
  ): Promise<void> {
    const consumed =
      await this.sessions.findConsumedRefreshTokenByHash(presentedDigest);
    if (consumed === null) {
      return;
    }

    await this.sessions.revokeSessionsByTokenFamily(
      consumed.tokenFamilyId,
      now,
    );
    this.logger.warn(
      {
        module: 'auth',
        operation: 'auth.refresh.reuse_detected',
        sessionId: consumed.sessionId,
        tokenFamilyId: consumed.tokenFamilyId,
        subjectType: AuthSubjectType.USER,
      },
      'Refresh token reuse detected for missing session; token family revoked',
    );
    throw new AuthError(
      AuthErrorCode.REFRESH_TOKEN_REUSED,
      'Refresh token reuse detected.',
    );
  }

  private logRefreshRejected(
    reason: string,
    session?: AuthSessionRecord,
  ): void {
    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.refresh.rejected',
        reason,
        sessionId: session?.id,
        subjectId: session?.userId,
        subjectType: session === undefined ? undefined : AuthSubjectType.USER,
      },
      'Refresh rejected',
    );
  }
}
