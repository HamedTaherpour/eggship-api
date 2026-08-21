import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { ApplicationLogger } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { AdminsModule } from '../../../src/modules/admins/admins.module';
import { AdminIdentityService } from '../../../src/modules/admins/application/admin-identity.service';
import { AdminRepository } from '../../../src/modules/admins/infrastructure/admin.repository';
import { AdminSessionLifecycleService } from '../../../src/modules/auth/application/admin-session-lifecycle.service';
import { AuthError } from '../../../src/modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../../src/modules/auth/domain/auth-error-codes';
import { REFRESH_REUSE_RACE_GRACE_MS } from '../../../src/modules/auth/domain/auth-session';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { AdminAuthSessionRepository } from '../../../src/modules/auth/infrastructure/admin-auth-session.repository';
import { RefreshTokenService } from '../../../src/modules/auth/infrastructure/refresh-token.service';
import type { RefreshSessionResult } from '../../../src/modules/auth/application/session-lifecycle.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';

const PASSWORD = 'integration only never a default';

describe('Admin auth sessions (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let identity: AdminIdentityService;
  let admins: AdminRepository;
  let sessions: AdminAuthSessionRepository;
  let refreshTokens: RefreshTokenService;
  let lifecycle: AdminSessionLifecycleService;
  let emailCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        AdminsModule,
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
    identity = moduleRef.get(AdminIdentityService);
    admins = moduleRef.get(AdminRepository);
    sessions = moduleRef.get(AdminAuthSessionRepository);
    refreshTokens = moduleRef.get(RefreshTokenService);
    lifecycle = moduleRef.get(AdminSessionLifecycleService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateAuthPersistenceTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function nextEmail(): string {
    emailCounter += 1;
    return `ops.${emailCounter}.${Date.now() % 1_000_000}@eggship.test`;
  }

  async function seedAdmin(): Promise<{
    adminId: string;
    email: string;
  }> {
    const email = nextEmail();
    const admin = await identity.createAdmin({
      email,
      password: PASSWORD,
      role: AdminRole.WAREHOUSE,
    });
    return { adminId: admin.id, email };
  }

  async function seedRefreshableSession(): Promise<{
    adminId: string;
    sessionId: string;
    tokenFamilyId: string;
    rawToken: string;
  }> {
    const seeded = await seedAdmin();
    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const issued = refreshTokens.issueRefreshToken(sessionId);
    const now = new Date();

    await sessions.createSession({
      id: sessionId,
      adminId: seeded.adminId,
      refreshTokenHash: issued.digest,
      tokenFamilyId,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });

    return {
      adminId: seeded.adminId,
      sessionId,
      tokenFamilyId,
      rawToken: issued.rawToken,
    };
  }

  async function seedRefreshableSessionFor(adminId: string): Promise<{
    adminId: string;
    sessionId: string;
    tokenFamilyId: string;
    rawToken: string;
  }> {
    const sessionId = randomUUID();
    const tokenFamilyId = randomUUID();
    const issued = refreshTokens.issueRefreshToken(sessionId);
    const now = new Date();

    await sessions.createSession({
      id: sessionId,
      adminId,
      refreshTokenHash: issued.digest,
      tokenFamilyId,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });

    return {
      adminId,
      sessionId,
      tokenFamilyId,
      rawToken: issued.rawToken,
    };
  }

  it('persists a password hash and never stores plaintext', async () => {
    const { adminId, email } = await seedAdmin();
    const credential = await admins.findLoginCredentialByEmail(email);

    expect(credential?.id).toBe(adminId);
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(credential?.passwordHash).not.toContain(PASSWORD);

    const found = await admins.findById(adminId);
    expect(JSON.stringify(found)).not.toContain(PASSWORD);
    expect(JSON.stringify(found)).not.toContain(credential?.passwordHash);
  });

  it('allows multiple Admin sessions for one Admin', async () => {
    const { adminId } = await seedAdmin();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);

    const first = await sessions.createSession({
      adminId,
      refreshTokenHash: refreshTokens.issueRefreshToken(randomUUID()).digest,
      tokenFamilyId: randomUUID(),
      expiresAt,
    });
    const second = await sessions.createSession({
      adminId,
      refreshTokenHash: refreshTokens.issueRefreshToken(randomUUID()).digest,
      tokenFamilyId: randomUUID(),
      expiresAt,
    });

    const listed = await sessions.listActiveSessionsForAdmin(adminId, now);
    expect(listed.map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('looks up a session by refresh digest and revokes it', async () => {
    const seeded = await seedRefreshableSession();
    const digest = refreshTokens.digest(seeded.rawToken);
    const found = await sessions.findSessionByRefreshTokenHash(digest);
    expect(found?.id).toBe(seeded.sessionId);

    const revoked = await sessions.revokeSession(seeded.sessionId, new Date());
    expect(revoked).toBe(true);
    const after = await sessions.findSessionById(seeded.sessionId);
    expect(after?.revokedAt).not.toBeNull();
  });

  it('logout-all revokes every session for that Admin only', async () => {
    const first = await seedRefreshableSession();
    const second = await seedRefreshableSession();
    const extra = await sessions.createSession({
      adminId: first.adminId,
      refreshTokenHash: refreshTokens.issueRefreshToken(randomUUID()).digest,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await lifecycle.logoutAll({
      subjectId: first.adminId,
      subjectType: AuthSubjectType.ADMIN,
      sessionId: first.sessionId,
    });

    expect(
      (await sessions.findSessionById(first.sessionId))?.revokedAt,
    ).not.toBeNull();
    expect(
      (await sessions.findSessionById(extra.id))?.revokedAt,
    ).not.toBeNull();
    expect(
      (await sessions.findSessionById(second.sessionId))?.revokedAt,
    ).toBeNull();
  });

  it('rejects refresh when the Admin is disabled', async () => {
    const seeded = await seedRefreshableSession();
    await prisma.admin.update({
      where: { id: seeded.adminId },
      data: { isActive: false },
    });

    await expect(lifecycle.refresh(seeded.rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });
  });

  it('restricts deleting an Admin that still has sessions', async () => {
    const seeded = await seedRefreshableSession();

    await expect(
      prisma.admin.delete({ where: { id: seeded.adminId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('allows only one concurrent Admin refresh rotation to succeed', async () => {
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
    if (failed?.status === 'rejected') {
      expect(failed.reason).toBeInstanceOf(AuthError);
      expect((failed.reason as AuthError).code).toBe(
        AuthErrorCode.INVALID_TOKEN,
      );
    }

    const stored = await sessions.findSessionById(seeded.sessionId);
    expect(stored?.revokedAt).toBeNull();
  });

  it('reuse on one Admin token family does not revoke a sibling family', async () => {
    const { adminId } = await seedAdmin();
    const first = await seedRefreshableSessionFor(adminId);
    const second = await seedRefreshableSessionFor(adminId);

    await lifecycle.refresh(first.rawToken);
    await prisma.adminAuthRefreshTokenConsumption.updateMany({
      where: { sessionId: first.sessionId },
      data: {
        consumedAt: new Date(Date.now() - REFRESH_REUSE_RACE_GRACE_MS - 1_000),
      },
    });

    await expect(lifecycle.refresh(first.rawToken)).rejects.toMatchObject({
      code: AuthErrorCode.REFRESH_TOKEN_REUSED,
    });

    expect(
      (await sessions.findSessionById(first.sessionId))?.revokedAt,
    ).not.toBeNull();
    expect(
      (await sessions.findSessionById(second.sessionId))?.revokedAt,
    ).toBeNull();
    const sibling = await lifecycle.refresh(second.rawToken);
    expect(sibling.accessToken.length).toBeGreaterThan(0);
    expect(sibling.refreshToken).not.toBe(second.rawToken);
  });

  it('detects reuse of a rotated Admin refresh token and revokes the family', async () => {
    const seeded = await seedRefreshableSession();
    const first = await lifecycle.refresh(seeded.rawToken);

    await prisma.adminAuthRefreshTokenConsumption.updateMany({
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

  it('logout vs refresh leaves a revoked Admin session that cannot rotate', async () => {
    const seeded = await seedRefreshableSession();

    const [refreshResult, logoutResult] = await Promise.allSettled([
      lifecycle.refresh(seeded.rawToken),
      lifecycle.logoutCurrent({
        subjectId: seeded.adminId,
        subjectType: AuthSubjectType.ADMIN,
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
    }
  });

  it('logout-all vs refresh prevents continued Admin rotation', async () => {
    const seeded = await seedRefreshableSession();

    const [refreshResult] = await Promise.all([
      lifecycle.refresh(seeded.rawToken).catch((error: unknown) => error),
      lifecycle.logoutAll({
        subjectId: seeded.adminId,
        subjectType: AuthSubjectType.ADMIN,
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
