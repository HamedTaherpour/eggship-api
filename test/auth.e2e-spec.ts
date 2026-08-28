import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../src/modules/auth/domain/auth-cookies';
import type {
  AuthRefreshTokenConsumptionRecord,
  AuthSessionRecord,
  CreateAuthSessionInput,
  RotateRefreshTokenHashInput,
} from '../src/modules/auth/domain/auth-session';
import { AuthSessionRepository } from '../src/modules/auth/infrastructure/auth-session.repository';
import { RefreshTokenService } from '../src/modules/auth/infrastructure/refresh-token.service';
import type {
  CreateUserInput,
  UserRecord,
} from '../src/modules/users/domain/user';
import { UserRepository } from '../src/modules/users/infrastructure/user.repository';
import {
  bootstrapBrowserCsrf,
  browserRequest,
  type BrowserCsrfSession,
} from './helpers/csrf-browser';

class InMemoryUserRepository {
  private readonly users = new Map<string, UserRecord>();

  create(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      phone: input.phone,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByPhone(phone: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.phone === phone) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }
}

class InMemoryAuthSessionRepository {
  private readonly sessions = new Map<string, AuthSessionRecord>();
  private readonly consumptions = new Map<
    string,
    AuthRefreshTokenConsumptionRecord
  >();

  seed(session: AuthSessionRecord): void {
    this.sessions.set(session.id, session);
  }

  createSession(input: CreateAuthSessionInput): Promise<AuthSessionRecord> {
    const now = new Date();
    const session: AuthSessionRecord = {
      id: randomUUID(),
      userId: input.userId,
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

  findSessionById(id: string): Promise<AuthSessionRecord | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  findSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return Promise.resolve(session);
      }
    }
    return Promise.resolve(null);
  }

  listActiveSessionsForUser(
    userId: string,
    now: Date,
  ): Promise<AuthSessionRecord[]> {
    return Promise.resolve(
      [...this.sessions.values()].filter(
        (session) =>
          session.userId === userId &&
          session.revokedAt === null &&
          session.expiresAt.getTime() > now.getTime(),
      ),
    );
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

  revokeAllUserSessions(userId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
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
  ): Promise<AuthRefreshTokenConsumptionRecord | null> {
    return Promise.resolve(this.consumptions.get(refreshTokenHash) ?? null);
  }

  rotateRefreshTokenHash(
    input: RotateRefreshTokenHashInput,
  ): Promise<AuthSessionRecord | null> {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.refreshTokenHash !== input.currentRefreshTokenHash ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= input.now.getTime()
    ) {
      return Promise.resolve(null);
    }

    this.consumptions.set(input.currentRefreshTokenHash, {
      id: randomUUID(),
      sessionId: session.id,
      tokenFamilyId: input.tokenFamilyId,
      refreshTokenHash: input.currentRefreshTokenHash,
      consumedAt: input.now,
      expiresAt: input.consumptionExpiresAt,
    });

    const updated: AuthSessionRecord = {
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

describe('auth session lifecycle (e2e)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let sessions: InMemoryAuthSessionRepository;
  let refreshTokens: RefreshTokenService;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    users = new InMemoryUserRepository();
    sessions = new InMemoryAuthSessionRepository();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(UserRepository)
      .useValue(users)
      .overrideProvider(AuthSessionRepository)
      .useValue(sessions)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    refreshTokens = app.get(RefreshTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedSession(): Promise<{
    user: UserRecord;
    session: AuthSessionRecord;
    refreshToken: string;
  }> {
    const user = await users.create({
      phone: `+9891${String(Date.now()).slice(-8)}`,
    });
    const sessionId = randomUUID();
    const issued = refreshTokens.issueRefreshToken(sessionId);
    const now = new Date();
    const session: AuthSessionRecord = {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: issued.digest,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(now.getTime() + 86_400_000),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    sessions.seed(session);
    return { user, session, refreshToken: issued.rawToken };
  }

  it('rejects refresh without a refresh cookie', async () => {
    csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
    const response = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/refresh'),
      csrf,
    ).expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTH_REFRESH_TOKEN_MISSING' },
    });
    expect(response.headers['x-request-id']).toMatch(/^req_/u);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('refreshes successfully and sets new AT/RT cookies', async () => {
    const seeded = await seedSession();
    csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);

    const response = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/refresh'),
      csrf,
      [
        `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(seeded.refreshToken)}`,
      ],
    ).expect(200);

    expect(response.body).toEqual({ data: { authenticated: true } });
    expect(response.headers['cache-control']).toBe('no-store');

    const setCookie = response.headers['set-cookie'];
    const access = cookieValue(setCookie, ACCESS_TOKEN_COOKIE_NAME);
    const refresh = cookieValue(setCookie, REFRESH_TOKEN_COOKIE_NAME);
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(refresh).not.toBe(seeded.refreshToken);
    expect(JSON.stringify(response.body)).not.toContain(refresh);
    expect(JSON.stringify(response.body)).not.toContain(access);
  });

  it('logout clears cookies and is idempotent', async () => {
    const seeded = await seedSession();
    csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
    const refreshResponse = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/refresh'),
      csrf,
      [
        `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(seeded.refreshToken)}`,
      ],
    ).expect(200);
    const setCookie = refreshResponse.headers['set-cookie'];
    const access = cookieValue(setCookie, ACCESS_TOKEN_COOKIE_NAME);
    const refresh = cookieValue(setCookie, REFRESH_TOKEN_COOKIE_NAME);

    const logout = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/logout'),
      csrf,
      [
        `${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(access ?? '')}`,
        `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refresh ?? '')}`,
      ],
    ).expect(200);

    expect(logout.body).toEqual({ data: { authenticated: false } });
    const cleared = asCookieHeaders(logout.headers['set-cookie']);
    expect(cleared.some((value) => value.includes('Max-Age=0'))).toBe(true);

    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/logout'),
      csrf,
    ).expect(200);
  });

  it('logout-all requires authentication and clears cookies', async () => {
    csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/logout-all'),
      csrf,
    ).expect(401);

    const seeded = await seedSession();
    const refreshResponse = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/refresh'),
      csrf,
      [
        `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(seeded.refreshToken)}`,
      ],
    ).expect(200);
    const setCookie = refreshResponse.headers['set-cookie'];
    const access = cookieValue(setCookie, ACCESS_TOKEN_COOKIE_NAME);

    const response = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/logout-all'),
      csrf,
      [`${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(access ?? '')}`],
    ).expect(200);

    expect(response.body).toEqual({ data: { authenticated: false } });
  });
});
