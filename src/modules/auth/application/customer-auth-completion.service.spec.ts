import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { UserRecord } from '../../users/domain/user';
import type { UserRepository } from '../../users/infrastructure/user.repository';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../domain/otp-challenge';
import type { OtpVerificationGrantRecord } from '../domain/otp-verification-grant';
import type { AuthSessionRecord } from '../domain/auth-session';
import type { AuthSessionRepository } from '../infrastructure/auth-session.repository';
import type { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import type { OtpService } from './otp.service';
import { CustomerAuthCompletionService } from './customer-auth-completion.service';

describe('CustomerAuthCompletionService', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const grantId = randomUUID();
  const phone = '+989121234567';

  let otp: jest.Mocked<Pick<OtpService, 'consumeVerificationGrant'>>;
  let users: jest.Mocked<
    Pick<UserRepository, 'create' | 'findByPhone' | 'findById'>
  >;
  let sessions: jest.Mocked<Pick<AuthSessionRepository, 'createSession'>>;
  let accessTokens: jest.Mocked<Pick<AccessTokenService, 'issueAccessToken'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let prisma: { $transaction: jest.Mock };
  let service: CustomerAuthCompletionService;
  let refreshTokens: RefreshTokenService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    refreshTokens = new RefreshTokenService();
    otp = {
      consumeVerificationGrant: jest.fn(),
    };
    users = {
      create: jest.fn(),
      findByPhone: jest.fn(),
      findById: jest.fn(),
    };
    sessions = {
      createSession: jest.fn(),
    };
    accessTokens = {
      issueAccessToken: jest.fn().mockResolvedValue({
        token: 'access.jwt',
        expiresAt: new Date(now.getTime() + 900_000),
      }),
    };
    logger = { info: jest.fn() };
    prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    };

    service = new CustomerAuthCompletionService(
      otp as unknown as OtpService,
      users as unknown as UserRepository,
      sessions as unknown as AuthSessionRepository,
      refreshTokens,
      accessTokens as unknown as AccessTokenService,
      prisma as unknown as PrismaService,
      logger as unknown as ApplicationLogger,
      {
        getOrThrow: (key: string) => {
          if (key === 'JWT_ACCESS_TTL_SECONDS') {
            return 900;
          }
          if (key === 'REFRESH_TOKEN_TTL_SECONDS') {
            return 2_592_000;
          }
          throw new Error(`unexpected ${key}`);
        },
      } as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function grant(
    overrides: Partial<OtpVerificationGrantRecord> = {},
  ): OtpVerificationGrantRecord {
    return {
      grantId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId: randomUUID(),
      createdAtUnixMs: now.getTime(),
      expiresAtUnixMs: now.getTime() + 600_000,
      ...overrides,
    };
  }

  function user(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
      id: randomUUID(),
      phone,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('authenticates an existing active user and creates a session', async () => {
    const existing = user();
    otp.consumeVerificationGrant.mockResolvedValue(grant());
    users.findByPhone.mockResolvedValue(existing);
    sessions.createSession.mockImplementation((input) => {
      const session: AuthSessionRecord = {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        tokenFamilyId: input.tokenFamilyId,
        expiresAt: input.expiresAt,
        revokedAt: null,
        lastUsedAt: input.lastUsedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      return Promise.resolve(session);
    });

    const result = await service.completeAuthentication(grantId);

    expect(result.isNewUser).toBe(false);
    expect(result.profileComplete).toBe(true);
    expect(result.user.id).toBe(existing.id);
    expect(result.accessToken).toBe('access.jwt');
    expect(result.refreshToken).toContain('.');
    expect(result.accessToken).not.toContain(result.refreshToken);
    expect(users.create).not.toHaveBeenCalled();
    expect(sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.sessionId,
        userId: existing.id,
      }),
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'auth.customer.authenticated',
        subjectId: existing.id,
        isNewUser: false,
      }),
      expect.any(String),
    );
  });

  it('registers a new user when the phone is unknown', async () => {
    const created = user();
    otp.consumeVerificationGrant.mockResolvedValue(grant());
    users.findByPhone.mockResolvedValue(null);
    users.create.mockResolvedValue(created);
    sessions.createSession.mockResolvedValue({
      id: randomUUID(),
      userId: created.id,
      refreshTokenHash: 'x'.repeat(43),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 1_000),
      revokedAt: null,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.completeAuthentication(grantId);

    expect(result.isNewUser).toBe(true);
    expect(result.user.id).toBe(created.id);
    expect(users.create).toHaveBeenCalledWith({ phone }, expect.anything());
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'auth.customer.registered',
        isNewUser: true,
      }),
      expect.any(String),
    );
  });

  it('rejects inactive users without creating a session', async () => {
    otp.consumeVerificationGrant.mockResolvedValue(grant());
    users.findByPhone.mockResolvedValue(user({ isActive: false }));

    await expect(service.completeAuthentication(grantId)).rejects.toMatchObject(
      {
        code: AuthErrorCode.ACCOUNT_DISABLED,
      },
    );
    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'auth.customer.authentication_rejected',
        reason: 'account_disabled',
      }),
      expect.any(String),
    );
  });

  it('maps grant failures to verification-grant error codes', async () => {
    otp.consumeVerificationGrant.mockRejectedValue(
      new AuthError(AuthErrorCode.ALREADY_USED, 'used'),
    );
    await expect(service.completeAuthentication(grantId)).rejects.toMatchObject(
      {
        code: AuthErrorCode.VERIFICATION_GRANT_USED,
      },
    );

    otp.consumeVerificationGrant.mockRejectedValue(
      new AuthError(AuthErrorCode.EXPIRED, 'expired'),
    );
    await expect(service.completeAuthentication(grantId)).rejects.toMatchObject(
      {
        code: AuthErrorCode.VERIFICATION_GRANT_EXPIRED,
      },
    );

    otp.consumeVerificationGrant.mockRejectedValue(
      new AuthError(AuthErrorCode.INVALID, 'invalid'),
    );
    await expect(service.completeAuthentication(grantId)).rejects.toMatchObject(
      {
        code: AuthErrorCode.VERIFICATION_GRANT_INVALID,
      },
    );
  });

  it('does not trust a client phone and binds identity from the grant', async () => {
    const grantPhone = '+989999999999';
    const existing = user({ phone: grantPhone });
    otp.consumeVerificationGrant.mockResolvedValue(
      grant({ phone: grantPhone }),
    );
    users.findByPhone.mockResolvedValue(existing);
    sessions.createSession.mockResolvedValue({
      id: randomUUID(),
      userId: existing.id,
      refreshTokenHash: 'y'.repeat(43),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 1_000),
      revokedAt: null,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await service.completeAuthentication(grantId);

    expect(users.findByPhone).toHaveBeenCalledWith(
      grantPhone,
      expect.anything(),
    );
  });

  it('requires a new OTP when PostgreSQL fails after grant consume', async () => {
    otp.consumeVerificationGrant.mockResolvedValue(grant());
    prisma.$transaction.mockRejectedValue(new Error('postgres unavailable'));

    await expect(service.completeAuthentication(grantId)).rejects.toThrow(
      'postgres unavailable',
    );
    expect(sessions.createSession).not.toHaveBeenCalled();

    otp.consumeVerificationGrant.mockRejectedValue(
      new AuthError(AuthErrorCode.ALREADY_USED, 'used'),
    );
    await expect(service.completeAuthentication(grantId)).rejects.toMatchObject(
      {
        code: AuthErrorCode.VERIFICATION_GRANT_USED,
      },
    );
  });

  it('treats unique phone races as existing-user authentication', async () => {
    const existing = user();
    otp.consumeVerificationGrant.mockResolvedValue(grant());
    users.findByPhone
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const { Prisma } = await import('../../../generated/prisma/client');
    users.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    sessions.createSession.mockResolvedValue({
      id: randomUUID(),
      userId: existing.id,
      refreshTokenHash: 'z'.repeat(43),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 1_000),
      revokedAt: null,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.completeAuthentication(grantId);
    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(existing.id);
  });
});
