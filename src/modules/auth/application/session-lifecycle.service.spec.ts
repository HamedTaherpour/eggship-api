import type { ConfigService } from '@nestjs/config';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { UserRecord } from '../../users/domain/user';
import type { UserRepository } from '../../users/infrastructure/user.repository';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type {
  AuthRefreshTokenConsumptionRecord,
  AuthSessionRecord,
} from '../domain/auth-session';
import { REFRESH_REUSE_RACE_GRACE_MS } from '../domain/auth-session';
import { AuthSubjectType } from '../domain/subject-type';
import type { AuthSessionRepository } from '../infrastructure/auth-session.repository';
import type { AccessTokenService } from '../infrastructure/access-token.service';
import { RefreshTokenService } from '../infrastructure/refresh-token.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { randomUUID } from 'node:crypto';

describe('SessionLifecycleService', () => {
  const now = new Date('2026-08-21T00:00:00.000Z');
  const userId = randomUUID();
  const sessionId = randomUUID();
  const familyId = randomUUID();

  let sessions: jest.Mocked<AuthSessionRepository>;
  let users: jest.Mocked<UserRepository>;
  let refreshTokens: RefreshTokenService;
  let accessTokens: jest.Mocked<Pick<AccessTokenService, 'issueAccessToken'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info' | 'warn'>>;
  let service: SessionLifecycleService;
  let rawToken: string;
  let digest: string;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);

    refreshTokens = new RefreshTokenService();
    const issued = refreshTokens.issueRefreshToken(sessionId);
    rawToken = issued.rawToken;
    digest = issued.digest;

    sessions = {
      findSessionById: jest.fn(),
      rotateRefreshTokenHash: jest.fn(),
      findConsumedRefreshTokenByHash: jest.fn(),
      revokeSessionsByTokenFamily: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllUserSessions: jest.fn(),
    } as unknown as jest.Mocked<AuthSessionRepository>;

    users = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    accessTokens = {
      issueAccessToken: jest.fn().mockResolvedValue({
        token: 'access.jwt',
        expiresAt: new Date(now.getTime() + 900_000),
      }),
    };

    logger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    service = new SessionLifecycleService(
      sessions,
      users,
      refreshTokens,
      accessTokens as unknown as AccessTokenService,
      logger as unknown as ApplicationLogger,
      {
        getOrThrow: (key: string) => {
          if (key === 'JWT_ACCESS_TTL_SECONDS') {
            return 900;
          }
          throw new Error(`unexpected ${key}`);
        },
      } as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function activeSession(
    overrides: Partial<AuthSessionRecord> = {},
  ): AuthSessionRecord {
    return {
      id: sessionId,
      userId,
      refreshTokenHash: digest,
      tokenFamilyId: familyId,
      expiresAt: new Date(now.getTime() + 86_400_000),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function activeUser(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
      id: userId,
      phone: '+989121234567',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('rotates refresh tokens and issues a new access token', async () => {
    const session = activeSession();
    sessions.findSessionById.mockResolvedValue(session);
    users.findById.mockResolvedValue(activeUser());
    sessions.rotateRefreshTokenHash.mockResolvedValue(
      activeSession({ refreshTokenHash: 'rotated'.padEnd(43, 'a') }),
    );

    const result = await service.refresh(rawToken);

    expect(result.accessToken).toBe('access.jwt');
    expect(result.refreshToken).toMatch(
      new RegExp(`^${sessionId}\\.[A-Za-z0-9_-]{43}$`, 'u'),
    );
    expect(result.accessTokenTtlSeconds).toBe(900);
    expect(sessions.rotateRefreshTokenHash.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        sessionId,
        tokenFamilyId: familyId,
        currentRefreshTokenHash: digest,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'auth.refresh.succeeded' }),
      expect.any(String),
    );
  });

  it('maps missing refresh material to invalid token after parse failure', async () => {
    await expect(service.refresh('not-a-token')).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
    });
  });

  it('rejects revoked sessions', async () => {
    sessions.findSessionById.mockResolvedValue(
      activeSession({ revokedAt: now }),
    );

    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    });
  });

  it('rejects expired sessions', async () => {
    sessions.findSessionById.mockResolvedValue(
      activeSession({ expiresAt: new Date(now.getTime() - 1000) }),
    );

    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
    });
  });

  it('treats recent consumed digests as a concurrent race, not reuse', async () => {
    const session = activeSession({
      refreshTokenHash: 'current'.padEnd(43, 'b'),
    });
    sessions.findSessionById.mockResolvedValue(session);
    sessions.findConsumedRefreshTokenByHash.mockResolvedValue({
      id: randomUUID(),
      sessionId,
      tokenFamilyId: familyId,
      refreshTokenHash: digest,
      consumedAt: now,
      expiresAt: session.expiresAt,
    } satisfies AuthRefreshTokenConsumptionRecord);

    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
    });
    expect(sessions.revokeSessionsByTokenFamily.mock.calls).toHaveLength(0);
  });

  it('treats negative consumption age as a concurrent race, not reuse', async () => {
    const session = activeSession({
      refreshTokenHash: 'current'.padEnd(43, 'd'),
    });
    sessions.findSessionById.mockResolvedValue(session);
    sessions.findConsumedRefreshTokenByHash.mockResolvedValue({
      id: randomUUID(),
      sessionId,
      tokenFamilyId: familyId,
      refreshTokenHash: digest,
      consumedAt: new Date(now.getTime() + 5_000),
      expiresAt: session.expiresAt,
    });

    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
    });
    expect(sessions.revokeSessionsByTokenFamily.mock.calls).toHaveLength(0);
  });

  it('revokes the token family on confirmed reuse outside the race grace', async () => {
    const session = activeSession({
      refreshTokenHash: 'current'.padEnd(43, 'c'),
    });
    sessions.findSessionById.mockResolvedValue(session);
    sessions.findConsumedRefreshTokenByHash.mockResolvedValue({
      id: randomUUID(),
      sessionId,
      tokenFamilyId: familyId,
      refreshTokenHash: digest,
      consumedAt: new Date(now.getTime() - REFRESH_REUSE_RACE_GRACE_MS - 1),
      expiresAt: session.expiresAt,
    });
    sessions.revokeSessionsByTokenFamily.mockResolvedValue(1);

    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.REFRESH_TOKEN_REUSED,
    });
    expect(sessions.revokeSessionsByTokenFamily.mock.calls[0]).toEqual([
      familyId,
      now,
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'auth.refresh.reuse_detected' }),
      expect.any(String),
    );
  });

  it('logoutCurrent is idempotent when the session is already revoked', async () => {
    sessions.findSessionById.mockResolvedValue(
      activeSession({ revokedAt: now }),
    );
    sessions.revokeSession.mockResolvedValue(false);

    await expect(
      service.logoutCurrent({
        subjectId: userId,
        subjectType: AuthSubjectType.USER,
        sessionId,
      }),
    ).resolves.toBeUndefined();
  });

  it('logoutAll revokes every session for the subject', async () => {
    sessions.revokeAllUserSessions.mockResolvedValue(3);

    await service.logoutAll({
      subjectId: userId,
      subjectType: AuthSubjectType.USER,
      sessionId,
    });

    expect(sessions.revokeAllUserSessions.mock.calls[0]).toEqual([userId, now]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'auth.sessions.revoked_all',
        revokedCount: 3,
      }),
      expect.any(String),
    );
  });

  it('logoutAll forbids a non-customer subject instead of answering unauthenticated', async () => {
    // Approved contract: authenticated but wrong subject type is 403. Answering
    // 401 would tell a browser client to refresh and retry indefinitely.
    await expect(
      service.logoutAll({
        subjectId: randomUUID(),
        subjectType: AuthSubjectType.ADMIN,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });

    expect(sessions.revokeAllUserSessions.mock.calls).toHaveLength(0);
  });

  it('logoutCurrent forbids a non-customer subject before looking up a session', async () => {
    await expect(
      service.logoutCurrent({
        subjectId: randomUUID(),
        subjectType: AuthSubjectType.ADMIN,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });

    expect(sessions.findSessionById.mock.calls).toHaveLength(0);
    expect(sessions.revokeSession.mock.calls).toHaveLength(0);
  });

  it('logoutCurrent forbids revoking a session the principal does not own', async () => {
    sessions.findSessionById.mockResolvedValue(activeSession());

    await expect(
      service.logoutCurrent({
        subjectId: randomUUID(),
        subjectType: AuthSubjectType.USER,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.FORBIDDEN });

    expect(sessions.revokeSession.mock.calls).toHaveLength(0);
  });

  it('rejects disabled accounts before rotation', async () => {
    sessions.findSessionById.mockResolvedValue(activeSession());
    users.findById.mockResolvedValue(activeUser({ isActive: false }));

    await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(AuthError);
    await expect(service.refresh(rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });
  });
});
