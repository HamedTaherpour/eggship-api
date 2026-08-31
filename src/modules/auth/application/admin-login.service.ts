import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import { AdminIdentityService } from '../../admins/application/admin-identity.service';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  type AdminLoginFailureReason,
} from '../../audit/domain/audit-event';
import {
  InvalidAdminEmailError,
  normalizeAdminEmail,
} from '../../admins/domain/admin-email';
import { PASSWORD_HASHER } from '../auth.tokens';
import { fingerprintAdminLoginEmail } from '../domain/admin-email-fingerprint';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { PasswordHasher } from '../domain/password-hasher';
import { AuthSubjectType } from '../domain/subject-type';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { AdminAuthSessionRepository } from '../infrastructure/admin-auth-session.repository';
import { AdminLoginAbuseLimiterService } from '../infrastructure/admin-login-abuse.limiter';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';

export interface AdminLoginCommand {
  email: string;
  password: string;
  clientIp?: string;
}

export interface AdminLoginResult {
  accessToken: string;
  refreshToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenMaxAgeSeconds: number;
  admin: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Admin email+password login. Controllers own cookie I/O.
 *
 * Unknown-email and wrong-password both verify against Argon2id (dummy hash
 * when the Admin is missing) so the public outcome and approximate cost match.
 * The dummy hash is computed once at process start, never per request.
 */
@Injectable()
export class AdminLoginService implements OnModuleInit {
  private dummyPasswordHash: string | undefined;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly otpHashSecret: string;

  constructor(
    private readonly admins: AdminIdentityService,
    private readonly sessions: AdminAuthSessionRepository,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly abuse: AdminLoginAbuseLimiterService,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasher,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
    config: ConfigService,
  ) {
    this.accessTokenTtlSeconds = config.getOrThrow<number>(
      'JWT_ACCESS_TTL_SECONDS',
    );
    this.refreshTokenTtlSeconds = config.getOrThrow<number>(
      'REFRESH_TOKEN_TTL_SECONDS',
    );
    this.otpHashSecret = config.getOrThrow<string>('OTP_HASH_SECRET');
  }

  async onModuleInit(): Promise<void> {
    const dummyPassword = randomBytes(32).toString('base64url');
    this.dummyPasswordHash = await this.passwords.hash(dummyPassword);
  }

  async login(command: AdminLoginCommand): Promise<AdminLoginResult> {
    const canonical = this.canonicalizeOrDummyKey(command.email);
    const emailFingerprint = fingerprintAdminLoginEmail(
      canonical,
      this.otpHashSecret,
    );

    const abuseDecision = await this.abuse.consume({
      emailFingerprint,
      clientIp: command.clientIp,
    });
    if (!abuseDecision.allowed) {
      await this.recordLoginFailure('rate_limited');
      this.logger.info(
        {
          module: 'auth',
          operation: 'admin.auth.login.rejected',
          reason: 'rate_limited',
        },
        'Admin login rejected',
      );
      throw new AuthError(
        AuthErrorCode.LOGIN_RATE_LIMITED,
        'Too many login attempts. Try again later.',
        {
          retryAfterSeconds: abuseDecision.retryAfterSeconds ?? 1,
        },
      );
    }

    const credential = await this.admins.findLoginCredential(command.email);
    const passwordOk = await this.passwords.verify(
      credential?.passwordHash ?? this.requireDummyHash(),
      command.password,
    );

    if (credential === null || !passwordOk) {
      await this.recordLoginFailure('invalid_credentials');
      this.logger.info(
        {
          module: 'auth',
          operation: 'admin.auth.login.rejected',
          reason: 'invalid_credentials',
        },
        'Admin login rejected',
      );
      throw new AuthError(
        AuthErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password.',
      );
    }

    if (!credential.isActive) {
      await this.recordLoginFailure('account_disabled');
      this.logger.info(
        {
          module: 'auth',
          operation: 'admin.auth.login.rejected',
          reason: 'account_disabled',
          subjectId: credential.id,
          subjectType: AuthSubjectType.ADMIN,
        },
        'Admin login rejected',
      );
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }

    const admin = await this.admins.findById(credential.id);
    if (admin === null || !admin.isActive) {
      await this.recordLoginFailure('account_disabled');
      this.logger.info(
        {
          module: 'auth',
          operation: 'admin.auth.login.rejected',
          reason: 'account_disabled',
          subjectId: credential.id,
          subjectType: AuthSubjectType.ADMIN,
        },
        'Admin login rejected',
      );
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }

    const now = new Date();
    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const issuedRefresh = this.refreshTokens.issueRefreshToken(sessionId);
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );

    await this.transactions.run(async (tx) => {
      await this.sessions.createSession(
        {
          id: sessionId,
          adminId: admin.id,
          refreshTokenHash: issuedRefresh.digest,
          tokenFamilyId,
          expiresAt,
          lastUsedAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          action: AuditAction.ADMIN_LOGIN_SUCCEEDED,
          actorType: AuditActorType.ADMIN,
          actorId: admin.id,
          entityType: AuditEntityType.ADMIN,
          entityId: admin.id,
          metadata: { sessionId },
        },
        tx,
      );
    });

    const access = await this.accessTokens.issueAccessToken({
      subjectId: admin.id,
      subjectType: AuthSubjectType.ADMIN,
      sessionId,
    });

    this.logger.info(
      {
        module: 'auth',
        operation: 'admin.auth.login.succeeded',
        subjectId: admin.id,
        subjectType: AuthSubjectType.ADMIN,
        sessionId,
      },
      'Admin login succeeded',
    );

    return {
      accessToken: access.token,
      refreshToken: issuedRefresh.rawToken,
      accessTokenTtlSeconds: this.accessTokenTtlSeconds,
      refreshTokenMaxAgeSeconds: this.refreshTokenTtlSeconds,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  private canonicalizeOrDummyKey(email: string): string {
    try {
      return normalizeAdminEmail(email);
    } catch (error: unknown) {
      if (error instanceof InvalidAdminEmailError) {
        return `invalid:${email.trim().toLowerCase()}`;
      }
      throw error;
    }
  }

  private requireDummyHash(): string {
    if (this.dummyPasswordHash === undefined) {
      throw new Error('Admin login dummy password hash is not initialized.');
    }
    return this.dummyPasswordHash;
  }

  private async recordLoginFailure(
    reason: AdminLoginFailureReason,
  ): Promise<void> {
    try {
      await this.audit.append({
        action: AuditAction.ADMIN_LOGIN_FAILED,
        actorType: AuditActorType.ANONYMOUS,
        actorId: null,
        entityType: AuditEntityType.ADMIN,
        entityId: null,
        metadata: { reason },
      });
    } catch {
      this.logger.warn(
        {
          module: 'auth',
          operation: 'admin.auth.login.audit_persistence_failed',
          reason,
        },
        'Admin login failure audit persistence failed',
      );
    }
  }
}
