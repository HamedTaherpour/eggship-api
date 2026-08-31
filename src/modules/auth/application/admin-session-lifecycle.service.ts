import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { AdminIdentityService } from '../../admins/application/admin-identity.service';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../audit/domain/audit-event';
import type { AdminAuthSessionRecord } from '../domain/admin-auth-session';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import {
  classifyRefreshDigestMismatch,
  remainingSessionSeconds,
} from '../domain/refresh-reuse';
import { AuthSubjectType } from '../domain/subject-type';
import { AdminAuthSessionRepository } from '../infrastructure/admin-auth-session.repository';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import type { RefreshSessionResult } from './session-lifecycle.service';

/**
 * Admin refresh rotation, reuse detection, and logout.
 * Mirrors User session semantics with a dedicated persistence model (ADR 0009).
 */
@Injectable()
export class AdminSessionLifecycleService {
  private readonly accessTokenTtlSeconds: number;

  constructor(
    private readonly sessions: AdminAuthSessionRepository,
    private readonly admins: AdminIdentityService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
    config: ConfigService,
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

    await this.assertAdminActive(session.adminId);

    const issuedRefresh = this.refreshTokens.issueRefreshToken(session.id);
    const access = await this.accessTokens.issueAccessToken({
      subjectId: session.adminId,
      subjectType: AuthSubjectType.ADMIN,
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
        operation: 'admin.auth.refresh.succeeded',
        sessionId: session.id,
        subjectType: AuthSubjectType.ADMIN,
        subjectId: session.adminId,
      },
      'Admin refresh token rotated',
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

  async logoutCurrent(
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<void> {
    const now = new Date();
    if (principal === undefined) {
      return;
    }
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const session = await this.sessions.findSessionById(principal.sessionId);
    if (session === null) {
      return;
    }
    if (session.adminId !== principal.subjectId) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const revoked = await this.sessions.revokeSession(session.id, now);
    if (revoked) {
      this.logger.info(
        {
          module: 'auth',
          operation: 'admin.auth.session.revoked',
          sessionId: session.id,
          subjectType: principal.subjectType,
          subjectId: principal.subjectId,
          scope: 'current',
        },
        'Admin auth session revoked',
      );
    }
  }

  async logoutAll(principal: AuthenticatedPrincipal): Promise<void> {
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const now = new Date();
    await this.transactions.run(async (tx) => {
      await this.sessions.revokeAllAdminSessions(principal.subjectId, now, tx);
      await this.audit.append(
        {
          action: AuditAction.ADMIN_SESSIONS_REVOKED_ALL,
          actorType: AuditActorType.ADMIN,
          actorId: principal.subjectId,
          entityType: AuditEntityType.ADMIN,
          entityId: principal.subjectId,
          metadata: undefined,
        },
        tx,
      );
    });

    this.logger.info(
      {
        module: 'auth',
        operation: 'admin.auth.sessions.revoked_all',
        subjectType: principal.subjectType,
        subjectId: principal.subjectId,
      },
      'All admin auth sessions revoked for subject',
    );
  }

  async requireCurrentAdmin(principal: AuthenticatedPrincipal): Promise<{
    id: string;
    email: string;
    role: string;
  }> {
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
    }

    const admin = await this.admins.findById(principal.subjectId);
    if (admin === null || !admin.isActive) {
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }

    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };
  }

  private assertSessionRefreshable(
    session: AdminAuthSessionRecord,
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

  private async assertAdminActive(adminId: string): Promise<void> {
    const admin = await this.admins.findById(adminId);
    if (admin === null || !admin.isActive) {
      this.logRefreshRejected('account_disabled');
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }
  }

  private async handleDigestMismatch(
    session: AdminAuthSessionRecord,
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
      await this.transactions.run(async (tx) => {
        await this.sessions.revokeSessionsByTokenFamily(
          session.tokenFamilyId,
          now,
          tx,
        );
        await this.audit.append(
          {
            action: AuditAction.ADMIN_REFRESH_REUSE_DETECTED,
            actorType: AuditActorType.ADMIN,
            actorId: session.adminId,
            entityType: AuditEntityType.ADMIN,
            entityId: session.adminId,
            metadata: { sessionId: session.id },
          },
          tx,
        );
      });
      this.logger.warn(
        {
          module: 'auth',
          operation: 'admin.auth.refresh.reuse_detected',
          sessionId: session.id,
          tokenFamilyId: session.tokenFamilyId,
          subjectId: session.adminId,
          subjectType: AuthSubjectType.ADMIN,
        },
        'Admin refresh token reuse detected; token family revoked',
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

    const session = await this.sessions.findSessionById(consumed.sessionId);
    if (session === null) {
      return;
    }
    await this.transactions.run(async (tx) => {
      await this.sessions.revokeSessionsByTokenFamily(
        consumed.tokenFamilyId,
        now,
        tx,
      );
      await this.audit.append(
        {
          action: AuditAction.ADMIN_REFRESH_REUSE_DETECTED,
          actorType: AuditActorType.ADMIN,
          actorId: session.adminId,
          entityType: AuditEntityType.ADMIN,
          entityId: session.adminId,
          metadata: { sessionId: consumed.sessionId },
        },
        tx,
      );
    });
    this.logger.warn(
      {
        module: 'auth',
        operation: 'admin.auth.refresh.reuse_detected',
        sessionId: consumed.sessionId,
        tokenFamilyId: consumed.tokenFamilyId,
        subjectType: AuthSubjectType.ADMIN,
        subjectId: session.adminId,
      },
      'Admin refresh token reuse detected for missing session; token family revoked',
    );
    throw new AuthError(
      AuthErrorCode.REFRESH_TOKEN_REUSED,
      'Refresh token reuse detected.',
    );
  }

  private logRefreshRejected(
    reason: string,
    session?: AdminAuthSessionRecord,
  ): void {
    this.logger.info(
      {
        module: 'auth',
        operation: 'admin.auth.refresh.rejected',
        reason,
        sessionId: session?.id,
        subjectId: session?.adminId,
        subjectType: session === undefined ? undefined : AuthSubjectType.ADMIN,
      },
      'Admin refresh rejected',
    );
  }
}
