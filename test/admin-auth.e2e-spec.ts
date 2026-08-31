import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { AdminRole } from '../src/common/authz/admin-role';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../src/infrastructure/database/transaction';
import { AuditLogService } from '../src/modules/audit/application/audit-log.service';
import { PASSWORD_HASHER } from '../src/modules/auth/auth.tokens';
import { AdminIdentityService } from '../src/modules/admins/application/admin-identity.service';
import type {
  AdminLoginCredential,
  AdminRecord,
} from '../src/modules/admins/domain/admin';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../src/modules/auth/domain/auth-cookies';
import type {
  AdminAuthRefreshTokenConsumptionRecord,
  AdminAuthSessionRecord,
  CreateAdminAuthSessionInput,
  RotateAdminRefreshTokenHashInput,
} from '../src/modules/auth/domain/admin-auth-session';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AccessTokenService } from '../src/modules/auth/infrastructure/access-token.service';
import { AdminAuthSessionRepository } from '../src/modules/auth/infrastructure/admin-auth-session.repository';
import type { PasswordHasher } from '../src/modules/auth/domain/password-hasher';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

const PASSWORD = 'correct horse battery staple';

class FastPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return Promise.resolve(`hash:${password}`);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return Promise.resolve(passwordHash === `hash:${password}`);
  }
}

class InMemoryAdminIdentity {
  private readonly byEmail = new Map<
    string,
    AdminRecord & { passwordHash: string }
  >();
  private readonly byId = new Map<
    string,
    AdminRecord & { passwordHash: string }
  >();

  seed(admin: AdminRecord & { passwordHash: string }): void {
    this.byEmail.set(admin.email, admin);
    this.byId.set(admin.id, admin);
  }

  findLoginCredential(email: string): Promise<AdminLoginCredential | null> {
    const found = this.byEmail.get(email.trim().toLowerCase());
    if (found === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: found.id,
      passwordHash: found.passwordHash,
      isActive: found.isActive,
    });
  }

  findById(id: string): Promise<AdminRecord | null> {
    const found = this.byId.get(id);
    if (found === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: found.id,
      email: found.email,
      role: found.role,
      isActive: found.isActive,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    });
  }

  setActive(id: string, isActive: boolean): void {
    const found = this.byId.get(id);
    if (found === undefined) {
      return;
    }
    found.isActive = isActive;
  }
}

class InMemoryAdminAuthSessionRepository {
  private readonly sessions = new Map<string, AdminAuthSessionRecord>();
  private readonly consumptions = new Map<
    string,
    AdminAuthRefreshTokenConsumptionRecord
  >();

  createSession(
    input: CreateAdminAuthSessionInput,
  ): Promise<AdminAuthSessionRecord> {
    const now = new Date();
    const session: AdminAuthSessionRecord = {
      id: input.id ?? randomUUID(),
      adminId: input.adminId,
      refreshTokenHash: input.refreshTokenHash,
      tokenFamilyId: input.tokenFamilyId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: input.lastUsedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  findSessionById(id: string): Promise<AdminAuthSessionRecord | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  revokeSession(sessionId: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.revokedAt !== null) {
      return Promise.resolve(false);
    }
    this.sessions.set(sessionId, {
      ...session,
      revokedAt,
      updatedAt: revokedAt,
    });
    return Promise.resolve(true);
  }

  revokeAllAdminSessions(adminId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.adminId === adminId && session.revokedAt === null) {
        this.sessions.set(session.id, {
          ...session,
          revokedAt,
          updatedAt: revokedAt,
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  revokeSessionsByTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
  ): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (
        session.tokenFamilyId === tokenFamilyId &&
        session.revokedAt === null
      ) {
        this.sessions.set(session.id, {
          ...session,
          revokedAt,
          updatedAt: revokedAt,
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  findConsumedRefreshTokenByHash(
    refreshTokenHash: string,
  ): Promise<AdminAuthRefreshTokenConsumptionRecord | null> {
    return Promise.resolve(this.consumptions.get(refreshTokenHash) ?? null);
  }

  rotateRefreshTokenHash(
    input: RotateAdminRefreshTokenHashInput,
  ): Promise<AdminAuthSessionRecord | null> {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.revokedAt !== null ||
      session.refreshTokenHash !== input.currentRefreshTokenHash ||
      session.expiresAt.getTime() <= input.now.getTime()
    ) {
      return Promise.resolve(null);
    }
    this.consumptions.set(input.currentRefreshTokenHash, {
      id: randomUUID(),
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      refreshTokenHash: input.currentRefreshTokenHash,
      consumedAt: input.now,
      expiresAt: input.consumptionExpiresAt,
    });
    const updated = {
      ...session,
      refreshTokenHash: input.newRefreshTokenHash,
      lastUsedAt: input.now,
      updatedAt: input.now,
    };
    this.sessions.set(session.id, updated);
    return Promise.resolve(updated);
  }
}

function asCookieHeaders(setCookie: string | string[] | undefined): string[] {
  if (setCookie === undefined) {
    return [];
  }
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function cookieValue(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  for (const header of asCookieHeaders(setCookie)) {
    if (header.startsWith(`${name}=`)) {
      const value = header.slice(name.length + 1).split(';')[0];
      return value === undefined || value === ''
        ? undefined
        : decodeURIComponent(value);
    }
  }
  return undefined;
}

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  requestId: string;
}

interface CurrentAdminBody {
  data: {
    admin: {
      id: string;
      email: string;
      role: string;
    };
  };
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

function asCurrentAdminBody(body: unknown): CurrentAdminBody {
  return body as CurrentAdminBody;
}

describe('Admin auth (e2e)', () => {
  const transactionRunner = {
    run: <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> =>
      fn({ [TRANSACTION_CONTEXT_BRAND]: true }),
    runIn: <T>(
      existing: TransactionContext | undefined,
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> => fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true }),
    runSnapshotRead: <T>(
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> => fn({ [TRANSACTION_CONTEXT_BRAND]: true }),
    runRepeatableRead: <T>(
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> => fn({ [TRANSACTION_CONTEXT_BRAND]: true }),
  } satisfies Pick<
    TransactionRunner,
    'run' | 'runIn' | 'runSnapshotRead' | 'runRepeatableRead'
  >;
  let app: INestApplication;
  let identity: InMemoryAdminIdentity;
  let sessions: InMemoryAdminAuthSessionRepository;
  let accessTokens: AccessTokenService;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    identity = new InMemoryAdminIdentity();
    sessions = new InMemoryAdminAuthSessionRepository();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(PASSWORD_HASHER)
      .useValue(new FastPasswordHasher())
      .overrideProvider(AdminIdentityService)
      .useValue(identity)
      .overrideProvider(AdminAuthSessionRepository)
      .useValue(sessions)
      .overrideProvider(TransactionRunner)
      .useValue(transactionRunner)
      .overrideProvider(AuditLogService)
      .useValue({ append: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    accessTokens = app.get(AccessTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    csrf = await bootstrapBrowserCsrf(server(), 'admin');
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function seedAdmin(overrides?: { email?: string; isActive?: boolean }): {
    id: string;
    email: string;
  } {
    const id = randomUUID();
    const email = overrides?.email ?? `ops.${id}@example.test`;
    identity.seed({
      id,
      email,
      passwordHash: `hash:${PASSWORD}`,
      role: AdminRole.WAREHOUSE,
      isActive: overrides?.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { id, email };
  }

  function login(email: string, password = PASSWORD): request.Test {
    return browserRequest(
      request(server()).post('/api/v1/admin/auth/login'),
      csrf,
    ).send({ email, password });
  }

  it('logs in with canonical email and sets namespaced Admin cookies', async () => {
    const seeded = seedAdmin({ email: 'ops.e2e@example.test' });
    const response = await login('  Ops.E2E@Example.TEST ', PASSWORD).expect(
      200,
    );

    expect(response.body).toMatchObject({
      data: {
        authenticated: true,
        admin: {
          id: seeded.id,
          email: seeded.email,
          role: AdminRole.WAREHOUSE,
        },
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^req_/u);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain('hash:');

    const setCookie = asCookieHeaders(response.headers['set-cookie']);
    expect(
      setCookie.some((row) =>
        row.startsWith(`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=`),
      ),
    ).toBe(true);
    expect(
      setCookie.some((row) =>
        row.startsWith(`${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=`),
      ),
    ).toBe(true);
    expect(setCookie.some((row) => row.includes('Path=/api/v1/admin'))).toBe(
      true,
    );
    expect(setCookie.some((row) => row.includes('HttpOnly'))).toBe(true);
    expect(
      setCookie.some((row) => row.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`)),
    ).toBe(false);
    expect(
      setCookie.some((row) => row.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`)),
    ).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(
      cookieValue(
        response.headers['set-cookie'],
        ADMIN_ACCESS_TOKEN_COOKIE_NAME,
      ),
    );
  });

  it('returns the same public error for unknown email and wrong password', async () => {
    const seeded = seedAdmin();
    const unknown = await login('nobody@example.test', PASSWORD).expect(401);
    const wrong = await login(
      seeded.email,
      'definitely not the password',
    ).expect(401);

    expect(asApiErrorBody(unknown.body).error.code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(asApiErrorBody(wrong.body).error.code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(asApiErrorBody(unknown.body).error.message).toBe(
      asApiErrorBody(wrong.body).error.message,
    );
    expect(asApiErrorBody(unknown.body).error.message).toBe(
      'Invalid email or password.',
    );
    expect(JSON.stringify(unknown.body)).not.toMatch(
      /not found|WRONG_ADMIN|EMAIL_NOT_FOUND/iu,
    );
  });

  it('returns Admin /me for an Admin token and 403 for a USER token', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const adminAt = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_ACCESS_TOKEN_COOKIE_NAME,
    );

    const me = await request(server())
      .get('/api/v1/admin/auth/me')
      .set('Cookie', `${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=${adminAt ?? ''}`)
      .expect(200);

    expect(asCurrentAdminBody(me.body).data.admin).toEqual({
      id: seeded.id,
      email: seeded.email,
      role: AdminRole.WAREHOUSE,
    });
    expect(me.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(me.body)).not.toContain('hash:');

    const userToken = await accessTokens.issueAccessToken({
      subjectId: randomUUID(),
      subjectType: AuthSubjectType.USER,
      sessionId: randomUUID(),
    });

    const forbidden = await request(server())
      .get('/api/v1/admin/auth/me')
      .set('Authorization', `Bearer ${userToken.token}`)
      .expect(403);
    expect(asApiErrorBody(forbidden.body).error.code).toBe('AUTH_FORBIDDEN');
  });

  it('forbids an ADMIN token on a customer-only route', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const adminAt = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_ACCESS_TOKEN_COOKIE_NAME,
    );

    const response = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminAt ?? ''}`)
      .expect(403);
    expect(asApiErrorBody(response.body).error.code).toBe('AUTH_FORBIDDEN');
  });

  it('refreshes Admin cookies without touching customer cookie names', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const refresh = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_REFRESH_TOKEN_COOKIE_NAME,
    );

    const response = await browserRequest(
      request(server()).post('/api/v1/admin/auth/refresh'),
      csrf,
      [
        `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refresh ?? '')}`,
      ],
    ).expect(200);

    expect(response.body).toEqual({ data: { authenticated: true } });
    expect(response.headers['cache-control']).toBe('no-store');
    const setCookie = asCookieHeaders(response.headers['set-cookie']);
    expect(
      setCookie.some((row) =>
        row.startsWith(`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=`),
      ),
    ).toBe(true);
    expect(
      setCookie.some((row) => row.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`)),
    ).toBe(false);
  });

  it('does not treat a User refresh cookie as an Admin session', async () => {
    const userRefresh = `${randomUUID()}.${'a'.repeat(43)}`;
    const response = await browserRequest(
      request(server()).post('/api/v1/admin/auth/refresh'),
      csrf,
      [`${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(userRefresh)}`],
    ).expect(401);
    expect(asApiErrorBody(response.body).error.code).toBe(
      'AUTH_REFRESH_TOKEN_MISSING',
    );
  });

  it('logout clears Admin cookies and is idempotent', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const access = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_ACCESS_TOKEN_COOKIE_NAME,
    );
    const refresh = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_REFRESH_TOKEN_COOKIE_NAME,
    );

    const logout = await browserRequest(
      request(server()).post('/api/v1/admin/auth/logout'),
      csrf,
      [
        `${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=${access ?? ''}`,
        `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=${refresh ?? ''}`,
      ],
    ).expect(200);

    expect(logout.body).toEqual({ data: { authenticated: false } });
    expect(
      asCookieHeaders(logout.headers['set-cookie']).some((row) =>
        row.includes('Max-Age=0'),
      ),
    ).toBe(true);

    await browserRequest(
      request(server()).post('/api/v1/admin/auth/logout'),
      csrf,
    ).expect(200);
  });

  it('rejects /me with AUTH_ACCOUNT_DISABLED after the Admin is deactivated', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const adminAt = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_ACCESS_TOKEN_COOKIE_NAME,
    );
    identity.setActive(seeded.id, false);

    const response = await request(server())
      .get('/api/v1/admin/auth/me')
      .set('Cookie', `${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=${adminAt ?? ''}`)
      .expect(403);
    expect(asApiErrorBody(response.body).error.code).toBe(
      'AUTH_ACCOUNT_DISABLED',
    );
    expect(JSON.stringify(response.body)).not.toContain('hash:');
  });

  it('rejects an inactive Admin after a correct password with AUTH_ACCOUNT_DISABLED', async () => {
    const seeded = seedAdmin({ isActive: false });
    const response = await login(seeded.email, PASSWORD).expect(403);
    expect(asApiErrorBody(response.body).error.code).toBe(
      'AUTH_ACCOUNT_DISABLED',
    );
  });

  it('rate-limits repeated Admin login attempts for the same email', async () => {
    const email = `limit.${randomUUID()}@example.test`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(email, 'wrong-password-value').expect(401);
    }
    const limited = await login(email, 'wrong-password-value').expect(429);
    expect(asApiErrorBody(limited.body).error.code).toBe('AUTH_RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('logout-all revokes Admin sessions for that Admin only', async () => {
    const seeded = seedAdmin();
    const loggedIn = await login(seeded.email).expect(200);
    const access = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_ACCESS_TOKEN_COOKIE_NAME,
    );

    await browserRequest(
      request(server()).post('/api/v1/admin/auth/logout-all'),
      csrf,
      [`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}=${access ?? ''}`],
    ).expect(200);

    const refresh = cookieValue(
      loggedIn.headers['set-cookie'],
      ADMIN_REFRESH_TOKEN_COOKIE_NAME,
    );
    await browserRequest(
      request(server()).post('/api/v1/admin/auth/refresh'),
      csrf,
      [
        `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refresh ?? '')}`,
      ],
    ).expect(401);
  });
});
