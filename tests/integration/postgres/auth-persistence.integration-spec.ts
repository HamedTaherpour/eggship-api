import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import {
  digestRefreshToken,
  generateRefreshToken,
} from '../../../src/modules/auth/domain/refresh-token-digest';
import { AuthSessionRepository } from '../../../src/modules/auth/infrastructure/auth-session.repository';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { UsersModule } from '../../../src/modules/users/users.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';

function uniquePhone(suffix: number): string {
  const national = `912${String(suffix).padStart(7, '0')}`.slice(0, 10);
  return `+98${national}`;
}

describe('User and AuthSession persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let sessions: AuthSessionRepository;
  let phoneCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        UsersModule,
        AuthModule,
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    sessions = moduleRef.get(AuthSessionRepository);
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

  it('enforces unique canonical phone identity', async () => {
    const phone = nextPhone();
    await users.create({ phone });

    await expect(users.create({ phone })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('rejects non-canonical phone at the repository boundary', async () => {
    await expect(users.create({ phone: '09121234567' })).rejects.toThrow(
      /canonical E\.164/u,
    );
  });

  it('allows multiple sessions per user', async () => {
    const user = await users.create({ phone: nextPhone() });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);

    const first = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt,
    });
    const second = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt,
    });

    expect(first.userId).toBe(user.id);
    expect(second.userId).toBe(user.id);
    expect(first.id).not.toBe(second.id);

    const active = await sessions.listActiveSessionsForUser(user.id, now);
    expect(active).toHaveLength(2);
  });

  it('looks up sessions by refresh-token digest equality', async () => {
    const user = await users.create({ phone: nextPhone() });
    const raw = generateRefreshToken();
    const hash = digestRefreshToken(raw);
    const created = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: hash,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const found = await sessions.findSessionByRefreshTokenHash(hash);
    expect(found?.id).toBe(created.id);
    expect(
      await sessions.findSessionByRefreshTokenHash(
        digestRefreshToken(generateRefreshToken()),
      ),
    ).toBeNull();
  });

  it('revokes a single session without deleting the row', async () => {
    const user = await users.create({ phone: nextPhone() });
    const now = new Date();
    const session = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 86_400_000),
    });

    const revoked = await sessions.revokeSession(session.id, now);
    expect(revoked).toBe(true);

    const stored = await sessions.findSessionById(session.id);
    expect(stored?.revokedAt).toEqual(now);
    expect(await sessions.listActiveSessionsForUser(user.id, now)).toHaveLength(
      0,
    );
  });

  it('revokes all sessions for a user', async () => {
    const user = await users.create({ phone: nextPhone() });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);

    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt,
    });
    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt,
    });

    const count = await sessions.revokeAllUserSessions(user.id, now);
    expect(count).toBe(2);
    expect(await sessions.listActiveSessionsForUser(user.id, now)).toHaveLength(
      0,
    );
  });

  it('excludes expired sessions from active listings', async () => {
    const user = await users.create({ phone: nextPhone() });
    const now = new Date('2026-08-20T12:00:00.000Z');

    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date('2026-08-20T11:00:00.000Z'),
    });
    const active = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date('2026-08-21T12:00:00.000Z'),
    });

    const listed = await sessions.listActiveSessionsForUser(user.id, now);
    expect(listed.map((row) => row.id)).toEqual([active.id]);
  });

  it('restricts deleting a user that still owns sessions', async () => {
    const user = await users.create({ phone: nextPhone() });
    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces globally unique refresh-token digests', async () => {
    const user = await users.create({ phone: nextPhone() });
    const hash = digestRefreshToken(generateRefreshToken());
    const expiresAt = new Date(Date.now() + 86_400_000);

    await sessions.createSession({
      userId: user.id,
      refreshTokenHash: hash,
      tokenFamilyId: randomUUID(),
      expiresAt,
    });

    await expect(
      sessions.createSession({
        userId: user.id,
        refreshTokenHash: hash,
        tokenFamilyId: randomUUID(),
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rotates refresh digests atomically under concurrency', async () => {
    const user = await users.create({ phone: nextPhone() });
    const currentHash = digestRefreshToken(generateRefreshToken());
    const now = new Date();
    const session = await sessions.createSession({
      userId: user.id,
      refreshTokenHash: currentHash,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 86_400_000),
    });

    const firstNew = digestRefreshToken(generateRefreshToken());
    const secondNew = digestRefreshToken(generateRefreshToken());

    const [resultA, resultB] = await Promise.all([
      sessions.rotateRefreshTokenHash({
        sessionId: session.id,
        tokenFamilyId: session.tokenFamilyId,
        currentRefreshTokenHash: currentHash,
        newRefreshTokenHash: firstNew,
        now,
        consumptionExpiresAt: session.expiresAt,
      }),
      sessions.rotateRefreshTokenHash({
        sessionId: session.id,
        tokenFamilyId: session.tokenFamilyId,
        currentRefreshTokenHash: currentHash,
        newRefreshTokenHash: secondNew,
        now,
        consumptionExpiresAt: session.expiresAt,
      }),
    ]);

    const successes = [resultA, resultB].filter((row) => row !== null);
    const failures = [resultA, resultB].filter((row) => row === null);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const stored = await sessions.findSessionById(session.id);
    expect(stored?.refreshTokenHash).toBe(successes[0]?.refreshTokenHash);
    expect([firstNew, secondNew]).toContain(stored?.refreshTokenHash);
  });
});
