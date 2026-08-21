import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { AdminRole } from '../../../common/authz/admin-role';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { AdminIdentityService } from '../../admins/application/admin-identity.service';
import type {
  AdminLoginCredential,
  AdminRecord,
} from '../../admins/domain/admin';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { PasswordHasher } from '../domain/password-hasher';
import type { AdminAuthSessionRepository } from '../infrastructure/admin-auth-session.repository';
import type { AdminLoginAbuseLimiterService } from '../infrastructure/admin-login-abuse.limiter';
import type { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import { AdminLoginService } from './admin-login.service';

const PASSWORD = 'correct horse battery staple';
const HASH = '$argon2id$mock-hash';

describe('AdminLoginService', () => {
  const adminId = randomUUID();
  const now = new Date('2026-08-21T00:00:00.000Z');

  let admins: jest.Mocked<
    Pick<AdminIdentityService, 'findLoginCredential' | 'findById'>
  >;
  let sessions: jest.Mocked<Pick<AdminAuthSessionRepository, 'createSession'>>;
  let accessTokens: jest.Mocked<Pick<AccessTokenService, 'issueAccessToken'>>;
  let abuse: jest.Mocked<Pick<AdminLoginAbuseLimiterService, 'consume'>>;
  let passwords: jest.Mocked<PasswordHasher>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: AdminLoginService;

  const admin: AdminRecord = {
    id: adminId,
    email: 'ops@example.test',
    role: AdminRole.WAREHOUSE,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const credential: AdminLoginCredential = {
    id: adminId,
    passwordHash: HASH,
    isActive: true,
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    admins = {
      findLoginCredential: jest.fn(),
      findById: jest.fn(),
    };
    sessions = { createSession: jest.fn().mockResolvedValue(undefined) };
    accessTokens = {
      issueAccessToken: jest.fn().mockResolvedValue({
        token: 'admin.access.jwt',
        expiresAt: new Date(now.getTime() + 900_000),
      }),
    };
    abuse = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
    passwords = {
      hash: jest.fn().mockResolvedValue('$argon2id$dummy'),
      verify: jest.fn(),
    };
    logger = { info: jest.fn() };

    service = new AdminLoginService(
      admins as unknown as AdminIdentityService,
      sessions as unknown as AdminAuthSessionRepository,
      new RefreshTokenService(),
      accessTokens as unknown as AccessTokenService,
      abuse as unknown as AdminLoginAbuseLimiterService,
      passwords,
      logger as unknown as ApplicationLogger,
      {
        getOrThrow: (key: string): string | number => {
          const values: Record<string, string | number> = {
            JWT_ACCESS_TTL_SECONDS: 900,
            REFRESH_TOKEN_TTL_SECONDS: 2592000,
            OTP_HASH_SECRET: 'unit-test-otp-hash-secret-32chars!!!!',
          };
          const value = values[key];
          if (value === undefined) {
            throw new Error(key);
          }
          return value;
        },
      } as ConfigService,
    );
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues an ADMIN session on valid credentials without returning the hash', async () => {
    admins.findLoginCredential.mockResolvedValue(credential);
    admins.findById.mockResolvedValue(admin);
    passwords.verify.mockResolvedValue(true);

    const result = await service.login({
      email: '  Ops@Example.TEST ',
      password: PASSWORD,
    });

    expect(result.accessToken).toBe('admin.access.jwt');
    expect(result.admin).toEqual({
      id: adminId,
      email: 'ops@example.test',
      role: AdminRole.WAREHOUSE,
    });
    expect(sessions.createSession).toHaveBeenCalled();
    expect(accessTokens.issueAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: adminId,
        subjectType: 'ADMIN',
      }),
    );
    expect(JSON.stringify(result)).not.toContain(HASH);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'ops@example.test',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(PASSWORD);
  });

  it('uses the dummy hash when the Admin is missing so verify still runs', async () => {
    admins.findLoginCredential.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'nobody@example.test', password: PASSWORD }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS });

    expect(passwords.verify.mock.calls).toEqual([
      ['$argon2id$dummy', PASSWORD],
    ]);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('returns the same public error for a wrong password', async () => {
    admins.findLoginCredential.mockResolvedValue(credential);
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.login({
        email: 'ops@example.test',
        password: 'wrong password!!',
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      service.login({
        email: 'ops@example.test',
        password: 'wrong password!!',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS });
  });

  it('rejects an inactive Admin after a successful password verify', async () => {
    admins.findLoginCredential.mockResolvedValue({
      ...credential,
      isActive: false,
    });
    passwords.verify.mockResolvedValue(true);

    await expect(
      service.login({ email: 'ops@example.test', password: PASSWORD }),
    ).rejects.toMatchObject({ code: AuthErrorCode.ACCOUNT_DISABLED });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('computes the dummy hash once at startup, not per missing-email request', async () => {
    admins.findLoginCredential.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);

    await service
      .login({ email: 'a@example.test', password: PASSWORD })
      .catch(() => undefined);
    await service
      .login({ email: 'b@example.test', password: PASSWORD })
      .catch(() => undefined);

    expect(passwords.hash.mock.calls).toHaveLength(1);
  });

  it('rejects login when the abuse limiter denies the attempt', async () => {
    abuse.consume.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    await expect(
      service.login({ email: 'ops@example.test', password: PASSWORD }),
    ).rejects.toMatchObject({
      code: AuthErrorCode.LOGIN_RATE_LIMITED,
      details: { retryAfterSeconds: 42 },
    });
    expect(admins.findLoginCredential).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
});
