import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
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
import { UserRepository } from '../src/modules/users/infrastructure/user.repository';

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

  /** Deterministic helper for expired-challenge e2e coverage. */
  expireChallenge(challengeId: string): void {
    const record = this.challenges.get(challengeId);
    if (record !== undefined) {
      record.expiresAtUnixMs = Date.now() - 1_000;
    }
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

interface OtpRequestSuccessBody {
  data: {
    challengeId: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  };
}

interface OtpVerifySuccessBody {
  data: {
    verificationGrantId: string;
    expiresInSeconds: number;
    purpose: string;
  };
}

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  requestId: string;
}

function asOtpRequestBody(body: unknown): OtpRequestSuccessBody {
  return body as OtpRequestSuccessBody;
}

function asOtpVerifyBody(body: unknown): OtpVerifySuccessBody {
  return body as OtpVerifySuccessBody;
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

describe('auth OTP HTTP (e2e)', () => {
  let app: INestApplication;
  let otpStore: MemoryOtpStore;
  let grantStore: MemoryGrantStore;
  const uniquePhone = (): string => `0912${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    grantStore = new MemoryGrantStore();
    otpStore = new MemoryOtpStore(grantStore);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(UserRepository)
      .useValue({
        create: (): never => {
          throw new Error('UserRepository must not be called for OTP e2e');
        },
        findById: (): Promise<null> => Promise.resolve(null),
        findByPhone: (): Promise<null> => Promise.resolve(null),
      })
      .overrideProvider(AuthSessionRepository)
      .useValue({})
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

  afterEach(() => {
    otpStore.challenges.clear();
    otpStore.consumed.clear();
    otpStore.cooldownUntil.clear();
    otpStore.phoneCounts.clear();
    otpStore.ipCounts.clear();
    grantStore.grants.clear();
    grantStore.consumed.clear();
  });

  it('requests OTP for a valid phone without echoing the code', async () => {
    const phone = uniquePhone();
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .expect(200);

    const body = asOtpRequestBody(response.body);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^req_/u);
    expect(body.data.challengeId).toEqual(expect.any(String));
    expect(body.data.expiresInSeconds).toEqual(expect.any(Number));
    expect(body.data.resendAfterSeconds).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain('111111');
    expect(JSON.stringify(body)).not.toContain(phone);
    expect(JSON.stringify(body)).not.toContain('+98');
  });

  it('normalizes alternative Iranian phone formats', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+98 912 123 4567' })
      .expect(200);

    expect(asOtpRequestBody(response.body).data.challengeId).toBeDefined();
    const stored = [...otpStore.challenges.values()][0];
    expect(stored?.phone).toBe('+989121234567');
  });

  it('rejects invalid phones and excess fields', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '02112345678' })
      .expect(400);

    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '09121234567', extra: true })
      .expect(400);
  });

  it('verifies the development code and returns a grant without phone', async () => {
    const requestResponse = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: uniquePhone() })
      .expect(200);
    const challengeId = asOtpRequestBody(requestResponse.body).data.challengeId;

    const verify = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId,
        code: '111111',
      })
      .expect(200);

    const verifyBody = asOtpVerifyBody(verify.body);
    expect(verify.headers['cache-control']).toBe('no-store');
    expect(verifyBody.data.verificationGrantId).toEqual(expect.any(String));
    expect(verifyBody.data.expiresInSeconds).toEqual(expect.any(Number));
    expect(verifyBody.data.purpose).toBe('customer_auth');
    expect(JSON.stringify(verifyBody)).not.toContain('111111');
    expect(JSON.stringify(verifyBody)).not.toContain('+98');
    expect(grantStore.grants.has(verifyBody.data.verificationGrantId)).toBe(
      true,
    );
  });

  it('rejects wrong codes and unknown challenges', async () => {
    const requestResponse = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: uniquePhone() })
      .expect(200);
    const challengeId = asOtpRequestBody(requestResponse.body).data.challengeId;

    const wrong = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId,
        code: '000000',
      })
      .expect(401);
    expect(asApiErrorBody(wrong.body).error.code).toBe('AUTH_OTP_INVALID');

    const missing = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId: '11111111-1111-4111-8111-111111111111',
        code: '111111',
      })
      .expect(401);
    expect(asApiErrorBody(missing.body).error.code).toBe('AUTH_OTP_INVALID');
  });

  it('rejects expired challenges', async () => {
    const requestResponse = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: uniquePhone() })
      .expect(200);
    const challengeId = asOtpRequestBody(requestResponse.body).data.challengeId;
    otpStore.expireChallenge(challengeId);

    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId, code: '111111' })
      .expect(401);
    expect(asApiErrorBody(response.body).error.code).toBe('AUTH_OTP_EXPIRED');
  });

  it('returns cooldown with Retry-After and does not leak account existence', async () => {
    const phone = uniquePhone();
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .expect(200);

    const cooldown = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .expect(429);

    const errorBody = asApiErrorBody(cooldown.body);
    expect(errorBody.error.code).toBe('AUTH_OTP_COOLDOWN');
    expect(errorBody.error.details['retryAfterSeconds']).toEqual(
      expect.any(Number),
    );
    expect(
      Number(errorBody.error.details['retryAfterSeconds']),
    ).toBeGreaterThan(0);
    expect(cooldown.headers['retry-after']).toBeDefined();
    expect(JSON.stringify(errorBody)).not.toContain('user');
    expect(JSON.stringify(errorBody)).not.toContain('exist');
  });

  it('rejects whitespace-padded OTP codes at the HTTP boundary', async () => {
    const requestResponse = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: uniquePhone() })
      .expect(200);
    const challengeId = asOtpRequestBody(requestResponse.body).data.challengeId;

    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId,
        code: '111111 ',
      })
      .expect(400);
  });
});
