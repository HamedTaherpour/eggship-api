import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { ApplicationLogger } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { SessionLifecycleService } from '../../../src/modules/auth/application/session-lifecycle.service';
import { AuthError } from '../../../src/modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../../src/modules/auth/domain/auth-error-codes';
import { REFRESH_REUSE_RACE_GRACE_MS } from '../../../src/modules/auth/domain/auth-session';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { AuthSessionRepository } from '../../../src/modules/auth/infrastructure/auth-session.repository';
import { RefreshTokenService } from '../../../src/modules/auth/infrastructure/refresh-token.service';
import type { RefreshSessionResult } from '../../../src/modules/auth/application/session-lifecycle.service';
import { UsersModule } from '../../../src/modules/users/users.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

describe('Auth session lifecycle (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let sessions: AuthSessionRepository;
  let refreshTokens: RefreshTokenService;
  let lifecycle: SessionLifecycleService;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        UsersModule,
        AuthModule,
      ],
    })
      .overrideProvider(ApplicationLogger)
      .useValue({
        debug: (): void => undefined,
        info: (): void => undefined,
        warn: (): void => undefined,
        error: (): void => undefined,
      })
      .compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    sessions = moduleRef.get(AuthSessionRepository);
    refreshTokens = moduleRef.get(RefreshTokenService);
    lifecycle = moduleRef.get(SessionLifecycleService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateAuthPersistenceTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function nextPhone(): string {
    phoneCounter += 1;
    return uniquePhone(phoneCounter + (Date.now() % 1_000_000));
  }

  async function seedRefreshableSession(): Promise<{
    userId: string;
    sessionId: string;
    tokenFamilyId: string;
    rawToken: string;
  }> {
    const user = await users.create({ phone: nextPhone() });
    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const issued = refreshTokens.issueRefreshToken(sessionId);
    const now = new Date();

    await prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: issued.digest,
        tokenFamilyId,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    });

    return {
      userId: user.id,
      sessionId,
      tokenFamilyId,
      rawToken: issued.rawToken,
    };
  }

  it('allows only one concurrent refresh rotation to succeed', async () => {
    const seeded = await seedRefreshableSession();

    const [first, second] = await Promise.allSettled([
      lifecycle.refresh(seeded.rawToken),
      lifecycle.refresh(seeded.rawToken),
    ]);

    const fulfilled = [first, second].filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = [first, second].filter(
      (result) => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failed = rejected[0];
    expect(failed?.status).toBe('rejected');
    if (failed?.status === 'rejected') {
      expect(failed.reason).toBeInstanceOf(AuthError);
      expect((failed.reason as AuthError).code).toBe(
        AuthErrorCode.INVALID_TOKEN,
      );
    }

    const stored = await sessions.findSessionById(seeded.sessionId);
    expect(stored?.revokedAt).toBeNull();
  });

  it('detects reuse of a previously rotated refresh token and revokes the family', async () => {
    const seeded = await seedRefreshableSession();
    const first = await lifecycle.refresh(seeded.rawToken);

    await prisma.authRefreshTokenConsumption.updateMany({
      where: { sessionId: seeded.sessionId },
      data: {
        consumedAt: new Date(Date.now() - REFRESH_REUSE_RACE_GRACE_MS - 1_000),
      },
    });

    await expect(lifecycle.refresh(seeded.rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.REFRESH_TOKEN_REUSED,
    });

    const stored = await sessions.findSessionById(seeded.sessionId);
    expect(stored?.revokedAt).not.toBeNull();
    expect(first.refreshToken).not.toBe(seeded.rawToken);
  });

  it('logout vs refresh leaves a revoked session that cannot rotate', async () => {
    const seeded = await seedRefreshableSession();

    const [refreshResult, logoutResult] = await Promise.allSettled([
      lifecycle.refresh(seeded.rawToken),
      lifecycle.logoutCurrent({
        subjectId: seeded.userId,
        subjectType: AuthSubjectType.USER,
        sessionId: seeded.sessionId,
      }),
    ]);

    expect(
      [refreshResult, logoutResult].filter((row) => row.status === 'fulfilled')
        .length,
    ).toBeGreaterThanOrEqual(1);

    const stored = await sessions.findSessionById(seeded.sessionId);
    expect(stored?.revokedAt).not.toBeNull();

    if (refreshResult.status === 'fulfilled') {
      await expect(
        lifecycle.refresh(refreshResult.value.refreshToken),
      ).rejects.toMatchObject({
        code: AuthErrorCode.SESSION_REVOKED,
      });
    } else {
      await expect(lifecycle.refresh(seeded.rawToken)).rejects.toBeInstanceOf(
        AuthError,
      );
    }
  });

  it('logout-all vs refresh prevents continued rotation', async () => {
    const seeded = await seedRefreshableSession();

    const [refreshResult] = await Promise.all([
      lifecycle.refresh(seeded.rawToken).catch((error: unknown) => error),
      lifecycle.logoutAll({
        subjectId: seeded.userId,
        subjectType: AuthSubjectType.USER,
        sessionId: seeded.sessionId,
      }),
    ]);

    const stored = await sessions.findSessionById(seeded.sessionId);
    expect(stored?.revokedAt).not.toBeNull();

    if (isRefreshSessionResult(refreshResult)) {
      await expect(
        lifecycle.refresh(refreshResult.refreshToken),
      ).rejects.toMatchObject({
        code: AuthErrorCode.SESSION_REVOKED,
      });
    }
  });
});

function isRefreshSessionResult(value: unknown): value is RefreshSessionResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('refreshToken' in value)
  ) {
    return false;
  }
  return typeof value.refreshToken === 'string';
}
