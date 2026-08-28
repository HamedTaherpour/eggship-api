import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  isUniqueConstraintError,
  UserRepository,
} from '../../users/infrastructure/user.repository';
import type { UserRecord } from '../../users/domain/user';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../domain/otp-challenge';
import { AuthSubjectType } from '../domain/subject-type';
import { AuthSessionRepository } from '../infrastructure/auth-session.repository';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import { OtpService } from './otp.service';
import { VisitorRepository } from '../../visitors/infrastructure/visitor.repository';
import {
  InvalidReferralCodeError,
  VisitorInactiveError,
} from '../../visitors/domain/visitor-errors';

export interface CustomerAuthCompletionResult {
  accessToken: string;
  refreshToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenMaxAgeSeconds: number;
  isNewUser: boolean;
  profileComplete: boolean;
  user: UserRecord;
  sessionId: string;
}

/**
 * Consumes an OTP verification grant and issues a customer AuthSession.
 * Controllers own cookie I/O; this service stays free of Express types.
 *
 * Handoff ordering (ADR 0006): consume Redis grant first, then PostgreSQL
 * find-or-create User + AuthSession. Persistence failure after consume requires
 * a fresh OTP; the grant is never replayable.
 */
@Injectable()
export class CustomerAuthCompletionService {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;

  constructor(
    private readonly otp: OtpService,
    private readonly users: UserRepository,
    private readonly sessions: AuthSessionRepository,
    private readonly refreshTokens: RefreshTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly prisma: PrismaService,
    private readonly visitors: VisitorRepository,
    private readonly logger: ApplicationLogger,
    config: ConfigService,
  ) {
    this.accessTokenTtlSeconds = config.getOrThrow<number>(
      'JWT_ACCESS_TTL_SECONDS',
    );
    this.refreshTokenTtlSeconds = config.getOrThrow<number>(
      'REFRESH_TOKEN_TTL_SECONDS',
    );
  }

  async completeAuthentication(
    verificationGrantId: string,
    referralCode?: string,
  ): Promise<CustomerAuthCompletionResult> {
    const grant = await this.consumeVerificationGrant(verificationGrantId);

    if (grant.purpose !== OTP_PURPOSE_CUSTOMER_AUTH) {
      this.logRejected('purpose_mismatch');
      throw new AuthError(
        AuthErrorCode.VERIFICATION_GRANT_INVALID,
        'Verification grant is invalid.',
      );
    }

    const now = new Date();
    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const issuedRefresh = this.refreshTokens.issueRefreshToken(sessionId);
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );

    let persisted: { user: UserRecord; isNewUser: boolean };
    try {
      persisted = await this.persistAuthentication(
        grant.phone,
        referralCode,
        now,
        sessionId,
        tokenFamilyId,
        issuedRefresh.digest,
        expiresAt,
      );
    } catch (error: unknown) {
      if (!(error instanceof UserCreationUniqueRaceError)) {
        if (
          error instanceof AuthError &&
          error.code === AuthErrorCode.ACCOUNT_DISABLED
        ) {
          this.logRejected('account_disabled');
        }
        throw error;
      }

      // The failed create has already aborted its PostgreSQL transaction.
      // Retry only after Prisma has rolled that transaction back, using a new
      // transaction/connection to prove the competing User now exists.
      persisted = await this.persistAuthentication(
        grant.phone,
        referralCode,
        now,
        sessionId,
        tokenFamilyId,
        issuedRefresh.digest,
        expiresAt,
        true,
      );
    }

    const { user, isNewUser } = persisted;

    const access = await this.accessTokens.issueAccessToken({
      subjectId: user.id,
      subjectType: AuthSubjectType.USER,
      sessionId,
    });

    this.logger.info(
      {
        module: 'auth',
        operation: isNewUser
          ? 'auth.customer.registered'
          : 'auth.customer.authenticated',
        subjectType: AuthSubjectType.USER,
        subjectId: user.id,
        sessionId,
        isNewUser,
      },
      isNewUser
        ? 'Customer registered and authenticated'
        : 'Customer authenticated',
    );

    return {
      accessToken: access.token,
      refreshToken: issuedRefresh.rawToken,
      accessTokenTtlSeconds: this.accessTokenTtlSeconds,
      refreshTokenMaxAgeSeconds: this.refreshTokenTtlSeconds,
      isNewUser,
      // AUTH-07 identity profile is phone-only; business fields await MIG-01 evidence.
      profileComplete: true,
      user,
      sessionId,
    };
  }

  private async persistAuthentication(
    phone: string,
    referralCode: string | undefined,
    now: Date,
    sessionId: string,
    tokenFamilyId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    resolveUserCreationRace = false,
  ): Promise<{ user: UserRecord; isNewUser: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      let existing = await this.users.findByPhone(phone, tx);
      let createdNew = false;

      if (existing === null) {
        if (resolveUserCreationRace) {
          existing = await this.users.findByPhone(phone, tx);
          if (existing === null) {
            throw new AuthError(
              AuthErrorCode.REGISTRATION_CONFLICT,
              'Registration could not be completed.',
            );
          }
        } else {
          try {
            existing = await this.users.create({ phone }, tx);
            createdNew = true;
          } catch (error: unknown) {
            if (!isUniqueConstraintError(error)) throw error;
            throw new UserCreationUniqueRaceError();
          }
        }
      }

      if (!existing.isActive) {
        throw new AuthError(
          AuthErrorCode.ACCOUNT_DISABLED,
          'Account is disabled.',
        );
      }

      if (createdNew && referralCode !== undefined) {
        const visitor = await this.visitors.findByReferralCodeForUpdate(
          referralCode,
          tx,
        );
        if (visitor === null) throw new InvalidReferralCodeError();
        if (!visitor.isActive) throw new VisitorInactiveError();
        await this.visitors.createAttribution(
          {
            userId: existing.id,
            visitorId: visitor.id,
            referralCode,
            attributedAt: now,
          },
          tx,
        );
      }

      await this.sessions.createSession(
        {
          id: sessionId,
          userId: existing.id,
          refreshTokenHash,
          tokenFamilyId,
          expiresAt,
          lastUsedAt: now,
        },
        tx,
      );

      return { user: existing, isNewUser: createdNew };
    });
  }

  private async consumeVerificationGrant(grantId: string): Promise<{
    phone: string;
    purpose: string;
  }> {
    try {
      return await this.otp.consumeVerificationGrant(grantId);
    } catch (error: unknown) {
      if (!(error instanceof AuthError)) {
        throw error;
      }
      switch (error.code) {
        case AuthErrorCode.EXPIRED:
          throw new AuthError(
            AuthErrorCode.VERIFICATION_GRANT_EXPIRED,
            'Verification grant has expired.',
          );
        case AuthErrorCode.ALREADY_USED:
          throw new AuthError(
            AuthErrorCode.VERIFICATION_GRANT_USED,
            'Verification grant was already used.',
          );
        case AuthErrorCode.INVALID:
        case AuthErrorCode.UNAVAILABLE:
          if (error.code === AuthErrorCode.UNAVAILABLE) {
            throw error;
          }
          throw new AuthError(
            AuthErrorCode.VERIFICATION_GRANT_INVALID,
            'Verification grant is invalid.',
          );
        default:
          throw error;
      }
    }
  }

  private logRejected(reason: string): void {
    this.logger.info(
      {
        module: 'auth',
        operation: 'auth.customer.authentication_rejected',
        reason,
      },
      'Customer authentication rejected',
    );
  }
}

class UserCreationUniqueRaceError extends Error {
  constructor() {
    super('User creation lost a uniqueness race.');
  }
}
