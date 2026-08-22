import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { AdminRole } from '../../../src/common/authz/admin-role';
import { AuthorizationService } from '../../../src/common/authz/authorization.service';
import { Permission } from '../../../src/common/authz/permission';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { AdminsModule } from '../../../src/modules/admins/admins.module';
import { AdminIdentityService } from '../../../src/modules/admins/application/admin-identity.service';
import { AdminEmailAlreadyExistsError } from '../../../src/modules/admins/domain/admin-errors';
import { AdminRepository } from '../../../src/modules/admins/infrastructure/admin.repository';
import {
  digestRefreshToken,
  generateRefreshToken,
} from '../../../src/modules/auth/domain/refresh-token-digest';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';

const PASSWORD = 'integration only never a default';

describe('Admin identity persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let admins: AdminRepository;
  let identity: AdminIdentityService;
  let authorization: AuthorizationService;
  let emailCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports([AdminsModule])],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    admins = moduleRef.get(AdminRepository);
    identity = moduleRef.get(AdminIdentityService);
    authorization = moduleRef.get(AuthorizationService);
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

  function adminPrincipal(adminId: string): {
    subjectId: string;
    subjectType: AuthSubjectType;
    sessionId: string;
  } {
    return {
      subjectId: adminId,
      subjectType: AuthSubjectType.ADMIN,
      sessionId: randomUUID(),
    };
  }

  it('stores the canonical email and finds it back through any casing', async () => {
    const email = nextEmail();
    const created = await identity.createAdmin({
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      role: AdminRole.WAREHOUSE,
    });

    expect(created.email).toBe(email);
    expect(await admins.findByEmail(email)).toMatchObject({ id: created.id });
    expect(await admins.findByEmail(` ${email.toUpperCase()}`)).toMatchObject({
      id: created.id,
    });
  });

  it('persists only an Argon2 hash, never the plaintext password', async () => {
    const created = await identity.createAdmin({
      email: nextEmail(),
      password: PASSWORD,
      role: AdminRole.ORDER_OPS,
    });

    const row = await prisma.admin.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(row.passwordHash).not.toContain(PASSWORD);
    // The record returned to callers carries no credential material at all.
    expect(Object.keys(created)).not.toContain('passwordHash');
  });

  it('rejects a duplicate canonical email that differs only in casing', async () => {
    const email = nextEmail();
    await identity.createAdmin({
      email,
      password: PASSWORD,
      role: AdminRole.WAREHOUSE,
    });

    await expect(
      identity.createAdmin({
        email: email.toUpperCase(),
        password: PASSWORD,
        role: AdminRole.SUPER_ADMIN,
      }),
    ).rejects.toBeInstanceOf(AdminEmailAlreadyExistsError);
  });

  it('lets exactly one concurrent creation of the same email commit', async () => {
    // The read-then-write pattern would admit both writers here; the unique
    // index is what makes the outcome deterministic.
    const email = nextEmail();
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        identity.createAdmin({
          email,
          password: PASSWORD,
          role: AdminRole.ORDER_OPS,
        }),
      ),
    );

    const fulfilled = attempts.filter((row) => row.status === 'fulfilled');
    const rejected = attempts.filter((row) => row.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const failure of rejected) {
      expect(failure.status).toBe('rejected');
      if (failure.status === 'rejected') {
        expect(failure.reason).toBeInstanceOf(AdminEmailAlreadyExistsError);
      }
    }
    expect(await prisma.admin.count({ where: { email } })).toBe(1);
  });

  it('refuses a non-canonical email at the database boundary too', async () => {
    // Defense in depth: even a writer that bypassed the repository cannot store
    // a mixed-case or untrimmed identity.
    await expect(
      prisma.admin.create({
        data: {
          email: `MixedCase.${Date.now()}@eggship.test`,
          passwordHash: '$argon2id$not-a-real-hash-but-long-enough',
          role: AdminRole.WAREHOUSE,
        },
      }),
    ).rejects.toThrow(/Admin_email_canonical_check/u);
  });

  it('persists every code-defined role and reads it back unchanged', async () => {
    for (const role of [
      AdminRole.SUPER_ADMIN,
      AdminRole.WAREHOUSE,
      AdminRole.ORDER_OPS,
    ]) {
      const created = await identity.createAdmin({
        email: nextEmail(),
        password: PASSWORD,
        role,
      });
      expect(created.role).toBe(role);
      expect(await admins.findAuthorizationState(created.id)).toMatchObject({
        role,
        isActive: true,
      });
    }
  });

  it('grants a persisted role its catalogued permissions through the seam', async () => {
    const created = await identity.createAdmin({
      email: nextEmail(),
      password: PASSWORD,
      role: AdminRole.WAREHOUSE,
    });

    const granted = await authorization.authorize(adminPrincipal(created.id), [
      Permission.INVENTORY_READ,
      Permission.INVENTORY_ADJUST,
    ]);
    expect(granted).toMatchObject({ granted: true });

    await expect(
      authorization.authorize(adminPrincipal(created.id), [
        Permission.ADMIN_MANAGE,
      ]),
    ).resolves.toEqual({ granted: false, reason: 'missing_permission' });
  });

  it('denies a deactivated admin every permission', async () => {
    const created = await identity.createAdmin({
      email: nextEmail(),
      password: PASSWORD,
      role: AdminRole.SUPER_ADMIN,
    });
    // Deactivation is an explicit persistence operation, not a generic patch.
    await prisma.admin.update({
      where: { id: created.id },
      data: { isActive: false },
    });

    await expect(
      authorization.authorize(adminPrincipal(created.id), [
        Permission.CATALOG_READ,
      ]),
    ).resolves.toEqual({ granted: false, reason: 'admin_inactive' });
    await expect(
      authorization.getPermissions(adminPrincipal(created.id)),
    ).resolves.toEqual(new Set());
  });

  it('denies an admin id with no persisted identity', async () => {
    await expect(
      authorization.authorize(adminPrincipal(randomUUID()), [
        Permission.CATALOG_READ,
      ]),
    ).resolves.toEqual({ granted: false, reason: 'admin_not_found' });
  });

  it('never resolves admin permissions from a customer subject id', async () => {
    const created = await identity.createAdmin({
      email: nextEmail(),
      password: PASSWORD,
      role: AdminRole.SUPER_ADMIN,
    });

    // Same identifier, USER subject type: a customer session cannot inherit the
    // admin identity that happens to share its id.
    await expect(
      authorization.getPermissions({
        subjectId: created.id,
        subjectType: AuthSubjectType.USER,
        sessionId: randomUUID(),
      }),
    ).resolves.toEqual(new Set());
  });

  it('keeps admin identity out of customer session persistence', async () => {
    const created = await identity.createAdmin({
      email: nextEmail(),
      password: PASSWORD,
      role: AdminRole.ORDER_OPS,
    });

    // AuthSession.userId is a non-nullable FK to User, so an admin id cannot be
    // stored as a customer session subject (ADR 0008).
    await expect(
      prisma.authSession.create({
        data: {
          userId: created.id,
          refreshTokenHash: digestRefreshToken(generateRefreshToken()),
          tokenFamilyId: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
