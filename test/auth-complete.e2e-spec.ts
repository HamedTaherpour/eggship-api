import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../src/modules/auth/domain/auth-cookies';
import type {
  AuthSessionRecord,
  CreateAuthSessionInput,
} from '../src/modules/auth/domain/auth-session';
import {
  OTP_STORE,
  OTP_VERIFICATION_GRANT_STORE,
} from '../src/modules/auth/auth.tokens';
import type {
  ConsumeOtpChallengeAndMintGrantInput,
  ConsumeOtpChallengeAndMintGrantOutcome,
  ConsumeOtpChallengeOutcome,
  CreateOtpChallengeInput,
  CreateOtpChallengeOutcome,
  OtpRateLimitWindow,
  OtpStore,
} from '../src/modules/auth/domain/otp-store';
import type {
  ConsumeOtpVerificationGrantOutcome,
  CreateOtpVerificationGrantInput,
  OtpVerificationGrantRecord,
  OtpVerificationGrantStore,
} from '../src/modules/auth/domain/otp-verification-grant';
import { AuthSessionRepository } from '../src/modules/auth/infrastructure/auth-session.repository';
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
  readonly users = new Map<string, UserRecord>();
  readonly byPhone = new Map<string, string>();

  create(input: CreateUserInput): Promise<UserRecord> {
    if (this.byPhone.has(input.phone)) {
      throw new Error('Unique phone constraint (in-memory)');
    }
    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      phone: input.phone,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    this.byPhone.set(user.phone, user.id);
    return Promise.resolve(user);
  }

  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByPhone(phone: string): Promise<UserRecord | null> {
    const id = this.byPhone.get(phone);
    return Promise.resolve(
      id === undefined ? null : (this.users.get(id) ?? null),
    );
  }

  seed(user: UserRecord): void {
    this.users.set(user.id, user);
    this.byPhone.set(user.phone, user.id);
  }

  clear(): void {
    this.users.clear();
    this.byPhone.clear();
  }
}

class InMemoryAuthSessionRepository {
  readonly sessions = new Map<string, AuthSessionRecord>();

  createSession(input: CreateAuthSessionInput): Promise<AuthSessionRecord> {
    const now = new Date();
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
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  findSessionById(id: string): Promise<AuthSessionRecord | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  clear(): void {
    this.sessions.clear();
  }
}

class MemoryGrantStore implements OtpVerificationGrantStore {
  grants = new Map<string, OtpVerificationGrantRecord>();
  consumed = new Set<string>();

  createGrant(input: CreateOtpVerificationGrantInput): Promise<void> {
    this.grants.set(input.grantId, {
      grantId: input.grantId,
      phone: input.phone,
      purpose: input.purpose,
      challengeId: input.challengeId,
      createdAtUnixMs: input.createdAtUnixMs,
      expiresAtUnixMs: input.createdAtUnixMs + input.ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  consumeGrant(grantId: string): Promise<ConsumeOtpVerificationGrantOutcome> {
    if (this.consumed.has(grantId)) {
      return Promise.resolve({ status: 'already_used' });
    }
    const record = this.grants.get(grantId);
    if (record === undefined) {
      return Promise.resolve({ status: 'missing' });
    }
    if (Date.now() >= record.expiresAtUnixMs) {
      this.grants.delete(grantId);
      return Promise.resolve({ status: 'expired' });
    }
    this.grants.delete(grantId);
    this.consumed.add(grantId);
    return Promise.resolve({ status: 'matched', record });
  }
}

class MemoryOtpStore implements OtpStore {
  challenges = new Map<
    string,
    CreateOtpChallengeInput & { attempts: number; expiresAtUnixMs: number }
  >();
  consumed = new Set<string>();
  cooldownUntil = new Map<string, number>();
  phoneCounts = new Map<string, number>();
  ipCounts = new Map<string, number>();

  constructor(private readonly grants: MemoryGrantStore) {}

  getPhoneCooldownRemaining(phone: string): Promise<number | null> {
    const until = this.cooldownUntil.get(phone);
    if (until === undefined) {
      return Promise.resolve(null);
    }
    const remainingMs = until - Date.now();
    if (remainingMs <= 0) {
      this.cooldownUntil.delete(phone);
      return Promise.resolve(null);
    }
    return Promise.resolve(Math.max(1, Math.ceil(remainingMs / 1000)));
  }

  createChallenge(
    input: CreateOtpChallengeInput,
  ): Promise<CreateOtpChallengeOutcome> {
    const now = input.createdAtUnixMs;
    const cooldownUntil = this.cooldownUntil.get(input.phone) ?? 0;
    if (now < cooldownUntil) {
      return Promise.resolve({
        status: 'cooldown',
        retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - now) / 1000)),
      });
    }
    this.cooldownUntil.set(
      input.phone,
      now + input.resendCooldownSeconds * 1000,
    );
    this.challenges.set(input.challengeId, {
      ...input,
      attempts: 0,
      expiresAtUnixMs: now + input.ttlSeconds * 1000,
    });
    return Promise.resolve({ status: 'created', previousChallengeId: null });
  }

  consumeChallenge(input: {
    challengeId: string;
    codeDigest: string;
  }): Promise<ConsumeOtpChallengeOutcome> {
    if (this.consumed.has(input.challengeId)) {
      return Promise.resolve({ status: 'already_used' });
    }
    const record = this.challenges.get(input.challengeId);
    if (record === undefined) {
      return Promise.resolve({ status: 'missing' });
    }
    if (Date.now() >= record.expiresAtUnixMs) {
      this.challenges.delete(input.challengeId);
      return Promise.resolve({ status: 'expired' });
    }
    if (record.attempts >= record.maxAttempts) {
      this.challenges.delete(input.challengeId);
      return Promise.resolve({ status: 'locked' });
    }
    if (record.codeDigest === input.codeDigest) {
      this.challenges.delete(input.challengeId);
      this.consumed.add(input.challengeId);
      return Promise.resolve({
        status: 'matched',
        record: {
          challengeId: record.challengeId,
          phone: record.phone,
          purpose: record.purpose,
          codeDigest: record.codeDigest,
          attempts: record.attempts,
          maxAttempts: record.maxAttempts,
          createdAtUnixMs: record.createdAtUnixMs,
          expiresAtUnixMs: record.expiresAtUnixMs,
        },
      });
    }
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      this.challenges.delete(input.challengeId);
      return Promise.resolve({ status: 'locked' });
    }
    return Promise.resolve({
      status: 'mismatch',
      attempts: record.attempts,
      remainingAttempts: record.maxAttempts - record.attempts,
    });
  }

  async consumeChallengeAndMintGrant(
    input: ConsumeOtpChallengeAndMintGrantInput,
  ): Promise<ConsumeOtpChallengeAndMintGrantOutcome> {
    const outcome = await this.consumeChallenge({
      challengeId: input.challengeId,
      codeDigest: input.codeDigest,
    });
    if (outcome.status !== 'matched') {
      return outcome;
    }
    await this.grants.createGrant({
      grantId: input.grantId,
      phone: outcome.record.phone,
      purpose: outcome.record.purpose,
      challengeId: outcome.record.challengeId,
      ttlSeconds: input.grantTtlSeconds,
      createdAtUnixMs: input.grantCreatedAtUnixMs,
    });
    return {
      status: 'matched',
      record: outcome.record,
      verificationGrantId: input.grantId,
      grantExpiresAtUnixMs:
        input.grantCreatedAtUnixMs + input.grantTtlSeconds * 1000,
    };
  }

  deleteChallenge(challengeId: string, phone: string): Promise<void> {
    void phone;
    this.challenges.delete(challengeId);
    return Promise.resolve();
  }

  incrementPhoneRequestCount(
    phone: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const count = (this.phoneCounts.get(phone) ?? 0) + 1;
    this.phoneCounts.set(phone, count);
    return Promise.resolve({
      allowed: count <= window.limit,
      retryAfterSeconds: window.windowSeconds,
    });
  }

  incrementIpRequestCount(
    ipFingerprint: string,
    window: OtpRateLimitWindow,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const count = (this.ipCounts.get(ipFingerprint) ?? 0) + 1;
    this.ipCounts.set(ipFingerprint, count);
    return Promise.resolve({
      allowed: count <= window.limit,
      retryAfterSeconds: window.windowSeconds,
    });
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

describe('auth complete + current user (e2e)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let sessions: InMemoryAuthSessionRepository;
  let otpStore: MemoryOtpStore;
  let grantStore: MemoryGrantStore;
  let csrf: BrowserCsrfSession;

  beforeAll(async () => {
    users = new InMemoryUserRepository();
    sessions = new InMemoryAuthSessionRepository();
    grantStore = new MemoryGrantStore();
    otpStore = new MemoryOtpStore(grantStore);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
          fn({}),
      })
      .overrideProvider(UserRepository)
      .useValue(users)
      .overrideProvider(AuthSessionRepository)
      .useValue(sessions)
      .overrideProvider(OTP_STORE)
      .useValue(otpStore)
      .overrideProvider(OTP_VERIFICATION_GRANT_STORE)
      .useValue(grantStore)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
  });

  afterEach(() => {
    users.clear();
    sessions.clear();
    otpStore.challenges.clear();
    otpStore.consumed.clear();
    otpStore.cooldownUntil.clear();
    otpStore.phoneCounts.clear();
    otpStore.ipCounts.clear();
    grantStore.grants.clear();
    grantStore.consumed.clear();
  });

  async function requestAndVerify(phone: string): Promise<string> {
    const requestResponse = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/otp/request'),
      csrf,
    )
      .send({ phone })
      .expect(200);
    const challengeId = (
      requestResponse.body as { data: { challengeId: string } }
    ).data.challengeId;

    const verifyResponse = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/otp/verify'),
      csrf,
    )
      .send({ challengeId, code: '111111' })
      .expect(200);

    return (verifyResponse.body as { data: { verificationGrantId: string } })
      .data.verificationGrantId;
  }

  it('registers a new user, sets cookies, and returns /auth/me', async () => {
    const phone = '09121112233';
    const grantId = await requestAndVerify(phone);

    const complete = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId, referralCode: 'NOT-A-CODE' })
      .expect(200);

    expect(complete.headers['cache-control']).toBe('no-store');
    expect(complete.headers['x-request-id']).toMatch(/^req_/u);
    const completeBody = complete.body as {
      data: {
        authenticated: boolean;
        isNewUser: boolean;
        profileComplete: boolean;
        user: { id: string };
      };
    };
    expect(completeBody.data.authenticated).toBe(true);
    expect(completeBody.data.isNewUser).toBe(true);
    expect(completeBody.data.profileComplete).toBe(true);
    expect(completeBody.data.user.id).toEqual(expect.any(String));
    expect(JSON.stringify(completeBody)).not.toMatch(/eggship_/u);

    const access = cookieValue(
      complete.headers['set-cookie'],
      ACCESS_TOKEN_COOKIE_NAME,
    );
    const refresh = cookieValue(
      complete.headers['set-cookie'],
      REFRESH_TOKEN_COOKIE_NAME,
    );
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(asCookieHeaders(complete.headers['set-cookie']).join(';')).toMatch(
      /HttpOnly/iu,
    );

    const me = await request(app.getHttpServer() as Server)
      .get('/api/v1/auth/me')
      .set(
        'Cookie',
        `${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(access!)}`,
      )
      .expect(200);

    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body).toMatchObject({
      data: {
        user: {
          id: completeBody.data.user.id,
          phone: '+989121112233',
          isActive: true,
          profileComplete: true,
        },
      },
    });
  });

  it('logs in an existing user without revoking prior sessions', async () => {
    const phone = '+989133344455';
    const existing: UserRecord = {
      id: randomUUID(),
      phone,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.seed(existing);
    const priorSessionId = randomUUID();
    sessions.sessions.set(priorSessionId, {
      id: priorSessionId,
      userId: existing.id,
      refreshTokenHash: `${'a'.repeat(43)}`,
      tokenFamilyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const grantId = await requestAndVerify('09133344455');
    const complete = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId })
      .expect(200);

    expect(complete.body).toMatchObject({
      data: { authenticated: true, isNewUser: false },
    });
    expect(sessions.sessions.get(priorSessionId)?.revokedAt).toBeNull();
    expect(sessions.sessions.size).toBe(2);
    expect(JSON.stringify(complete.body)).not.toMatch(/visitor|referral/iu);
  });

  it('documents the optional referral code without a referral-resolution endpoint', () => {
    const document = createOpenApiDocument(app);
    const complete = document.paths['/api/v1/auth/complete']?.post;
    const requestBody = complete?.requestBody as
      { content?: { 'application/json'?: { schema?: unknown } } } | undefined;
    const bodySchema = requestBody?.content?.['application/json']?.schema as
      { $ref?: string } | undefined;

    expect(bodySchema?.$ref).toBe('#/components/schemas/CompleteAuthBodyDto');
    expect(document.paths['/api/v1/referrals/resolve']).toBeUndefined();
    const schemas = document.components?.schemas as
      Record<string, { properties?: Record<string, unknown> }> | undefined;
    expect(
      schemas?.CompleteAuthBodyDto?.properties?.referralCode,
    ).toBeDefined();
  });

  it('rejects invalid, used, and inactive-user completions', async () => {
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: randomUUID() })
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({
          error: { code: 'AUTH_VERIFICATION_GRANT_INVALID' },
        });
      });

    const grantId = await requestAndVerify('09125556677');
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId })
      .expect(200);
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId })
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({
          error: { code: 'AUTH_VERIFICATION_GRANT_USED' },
        });
      });

    const inactivePhone = '+989166677788';
    users.seed({
      id: randomUUID(),
      phone: inactivePhone,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const inactiveGrant = await requestAndVerify('09166677788');
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: inactiveGrant })
      .expect(403)
      .expect((res) => {
        expect(res.body).toMatchObject({
          error: { code: 'AUTH_ACCOUNT_DISABLED' },
        });
      });
  });

  it('rejects unknown profile fields and accepts empty PATCH allowlist', async () => {
    const grantId = await requestAndVerify('09127778899');
    const complete = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId })
      .expect(200);
    const access = cookieValue(
      complete.headers['set-cookie'],
      ACCESS_TOKEN_COOKIE_NAME,
    );

    await browserRequest(
      request(app.getHttpServer() as Server).patch('/api/v1/users/me'),
      csrf,
      [`${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(access!)}`],
    )
      .send({ storeName: 'forbidden' })
      .expect(400);

    await browserRequest(
      request(app.getHttpServer() as Server).patch('/api/v1/users/me'),
      csrf,
      [`${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(access!)}`],
    )
      .send({})
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: { user: { phone: '+989127778899', profileComplete: true } },
        });
      });
  });

  it('rejects complete bodies that include phone', async () => {
    const grantId = await requestAndVerify('09128889900');
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/auth/complete'),
      csrf,
    )
      .send({ verificationGrantId: grantId, phone: '+989128889900' })
      .expect(400);
  });
});
