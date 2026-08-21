import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { OtpCodeIssuer } from '../domain/otp-code-issuer';
import { digestOtpCode } from '../domain/otp-digest';
import type {
  ConsumeOtpChallengeAndMintGrantInput,
  ConsumeOtpChallengeAndMintGrantOutcome,
  ConsumeOtpChallengeOutcome,
  CreateOtpChallengeInput,
  CreateOtpChallengeOutcome,
  OtpRateLimitWindow,
  OtpStore,
} from '../domain/otp-store';
import type {
  ConsumeOtpVerificationGrantOutcome,
  CreateOtpVerificationGrantInput,
  OtpVerificationGrantRecord,
  OtpVerificationGrantStore,
} from '../domain/otp-verification-grant';
import type { SmsProvider } from '../domain/sms-provider';
import { SmsDeliveryError } from '../domain/sms-provider';
import { OtpService } from './otp.service';

class MemoryOtpStore implements OtpStore {
  challenges = new Map<
    string,
    CreateOtpChallengeInput & { attempts: number; expiresAtUnixMs: number }
  >();
  consumed = new Set<string>();
  cooldownUntil = new Map<string, number>();
  phoneCounts = new Map<string, number>();
  ipCounts = new Map<string, number>();
  failNextMint = false;

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
    if (this.failNextMint) {
      this.failNextMint = false;
      throw new Error('simulated grant mint failure');
    }
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

interface OtpServiceTestHarness {
  service: OtpService;
  store: MemoryOtpStore;
  grants: MemoryGrantStore;
  smsCalls: Array<{ phone: string; code: string }>;
  output: () => string;
}

describe('OtpService', () => {
  const hashSecret = 'unit-test-otp-hash-secret-32chars!!!!';

  function build(options?: {
    store?: MemoryOtpStore;
    grants?: MemoryGrantStore;
    sms?: SmsProvider;
    code?: string;
  }): OtpServiceTestHarness {
    const grants = options?.grants ?? new MemoryGrantStore();
    const store = options?.store ?? new MemoryOtpStore(grants);
    const smsCalls: Array<{ phone: string; code: string }> = [];
    const sms: SmsProvider =
      options?.sms ??
      ({
        sendOtp: (input: { phone: string; code: string }): Promise<void> => {
          smsCalls.push(input);
          return Promise.resolve();
        },
      } satisfies SmsProvider);
    const issuer: OtpCodeIssuer = {
      issueCode: (): string => options?.code ?? '482913',
    };
    const destination = new PassThrough();
    let logs = '';
    destination.on('data', (chunk: Buffer) => {
      logs += chunk.toString('utf8');
    });
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'test',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'test',
      }),
      new RequestContextService(),
      destination,
    );
    const config = new ConfigService({
      OTP_HASH_SECRET: hashSecret,
      OTP_TTL_SECONDS: 300,
      OTP_MAX_ATTEMPTS: 3,
      OTP_RESEND_COOLDOWN_SECONDS: 60,
      OTP_PHONE_WINDOW_LIMIT: 5,
      OTP_PHONE_WINDOW_SECONDS: 3600,
      OTP_IP_WINDOW_LIMIT: 20,
      OTP_IP_WINDOW_SECONDS: 3600,
      OTP_VERIFICATION_GRANT_TTL_SECONDS: 600,
    });
    return {
      service: new OtpService(store, grants, sms, issuer, logger, config),
      store,
      grants,
      smsCalls,
      output: (): string => logs,
    };
  }

  it('requests an OTP with normalized phone and returns challenge metadata', async () => {
    const { service, store, smsCalls } = build();
    const result = await service.requestOtp({ phone: '09121234567' });

    expect(result.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(smsCalls).toEqual([{ phone: '+989121234567', code: '482913' }]);
    const stored = [...store.challenges.values()][0];
    expect(stored?.phone).toBe('+989121234567');
    expect(stored?.codeDigest).toBe(digestOtpCode('482913', hashSecret));
    expect(stored?.codeDigest).not.toContain('482913');
  });

  it('propagates trusted request-source IP into abuse accounting', async () => {
    const { service, store } = build();
    await service.requestOtp({
      phone: '+989121234567',
      source: { clientIp: '203.0.113.10' },
    });
    expect(store.ipCounts.size).toBe(1);
  });

  it('verifies a correct code once, mints a grant, and rejects challenge reuse', async () => {
    const { service, grants } = build();
    const requested = await service.requestOtp({ phone: '+989121234567' });
    const verified = await service.verifyOtp({
      challengeId: requested.challengeId,
      code: '482913',
    });
    expect(verified.phone).toBe('+989121234567');
    expect(verified.verificationGrantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(grants.grants.get(verified.verificationGrantId)?.phone).toBe(
      '+989121234567',
    );

    await expect(
      service.verifyOtp({
        challengeId: requested.challengeId,
        code: '482913',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_USED });

    const consumed = await service.consumeVerificationGrant(
      verified.verificationGrantId,
    );
    expect(consumed.phone).toBe('+989121234567');
    expect(consumed.purpose).toBe('customer_auth');

    await expect(
      service.consumeVerificationGrant(verified.verificationGrantId),
    ).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_USED });
  });

  it('rejects forged verification grant ids', async () => {
    const { service } = build();
    await expect(
      service.consumeVerificationGrant('11111111-1111-4111-8111-111111111111'),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID });
  });

  it('maps wrong codes to AUTH_OTP_INVALID and locks after max attempts', async () => {
    const { service } = build();
    const requested = await service.requestOtp({ phone: '+989121234567' });

    await expect(
      service.verifyOtp({
        challengeId: requested.challengeId,
        code: '000000',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID });

    await expect(
      service.verifyOtp({
        challengeId: requested.challengeId,
        code: '000001',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.INVALID });

    await expect(
      service.verifyOtp({
        challengeId: requested.challengeId,
        code: '000002',
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOO_MANY_ATTEMPTS });
  });

  it('deletes the challenge when SMS delivery fails', async () => {
    const grants = new MemoryGrantStore();
    const store = new MemoryOtpStore(grants);
    const { service } = build({
      store,
      grants,
      sms: {
        sendOtp: (): Promise<void> => Promise.reject(new SmsDeliveryError()),
      },
    });

    await expect(
      service.requestOtp({ phone: '+989121234567' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.DELIVERY_FAILED });
    expect(store.challenges.size).toBe(0);
  });

  it('enforces resend cooldown with AUTH_OTP_COOLDOWN', async () => {
    const { service } = build();
    await service.requestOtp({ phone: '+989121234567' });
    await expect(
      service.requestOtp({ phone: '+989121234567' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.COOLDOWN });
  });

  it('enforces phone request windows with AUTH_OTP_RATE_LIMITED', async () => {
    const grants = new MemoryGrantStore();
    const store = new MemoryOtpStore(grants);
    store.createChallenge = (
      input: CreateOtpChallengeInput,
    ): Promise<CreateOtpChallengeOutcome> => {
      store.challenges.set(input.challengeId, {
        ...input,
        attempts: 0,
        expiresAtUnixMs: input.createdAtUnixMs + input.ttlSeconds * 1000,
      });
      return Promise.resolve({ status: 'created', previousChallengeId: null });
    };
    const { service } = build({ store, grants });

    for (let i = 0; i < 5; i += 1) {
      await service.requestOtp({ phone: '+989121234567' });
    }
    await expect(
      service.requestOtp({ phone: '+989121234567' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED });
  });

  it('surfaces mint failures without claiming verify success', async () => {
    const grants = new MemoryGrantStore();
    const store = new MemoryOtpStore(grants);
    const { service } = build({ store, grants });
    const requested = await service.requestOtp({ phone: '+989121234567' });
    store.failNextMint = true;

    await expect(
      service.verifyOtp({
        challengeId: requested.challengeId,
        code: '482913',
      }),
    ).rejects.toThrow('simulated grant mint failure');

    // Memory path is not Redis-atomic; Redis Lua is. Retry still works here because
    // failNextMint aborts before consume. Confirm challenge remains usable.
    const verified = await service.verifyOtp({
      challengeId: requested.challengeId,
      code: '482913',
    });
    expect(verified.verificationGrantId).toBeDefined();
  });

  it('does not log OTP codes, digests, or phones', async () => {
    const { service, output } = build({ code: '482913' });
    const requested = await service.requestOtp({ phone: '+989121234567' });
    await service.verifyOtp({
      challengeId: requested.challengeId,
      code: '482913',
    });
    const logs = output();
    expect(logs).not.toContain('482913');
    expect(logs).not.toContain(digestOtpCode('482913', hashSecret));
    expect(logs).not.toContain('+989121234567');
  });

  it('does not put OTP values in AuthError messages', async () => {
    const { service } = build();
    const requested = await service.requestOtp({ phone: '+989121234567' });
    try {
      await service.verifyOtp({
        challengeId: requested.challengeId,
        code: '000000',
      });
      throw new Error('expected failure');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).message).not.toContain('000000');
      expect((error as AuthError).message).not.toContain('482913');
    }
  });
});
