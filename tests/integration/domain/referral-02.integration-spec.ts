import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { Prisma } from '../../../src/generated/prisma/client';
import { LOG_DESTINATION } from '../../../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { RedisClientFactory } from '../../../src/infrastructure/redis/redis-client.factory';
import { RedisModule } from '../../../src/infrastructure/redis/redis.module';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { CustomerAuthCompletionService } from '../../../src/modules/auth/application/customer-auth-completion.service';
import { OTP_PURPOSE_CUSTOMER_AUTH } from '../../../src/modules/auth/domain/otp-challenge';
import { OTP_REDIS_KEY_PREFIX } from '../../../src/modules/auth/infrastructure/otp-redis-keys';
import { RedisOtpVerificationGrantStore } from '../../../src/modules/auth/infrastructure/redis-otp-verification-grant-store';
import { UsersModule } from '../../../src/modules/users/users.module';
import { UserRepository } from '../../../src/modules/users/infrastructure/user.repository';
import { VisitorRepository } from '../../../src/modules/visitors/infrastructure/visitor.repository';
import { VisitorInactiveError } from '../../../src/modules/visitors/domain/visitor-errors';
import { truncateAuthPersistenceTables } from '../support/truncate-auth-tables';
import { redisIntegrationKeyPrefix } from '../support/test-run-id';

describe('REF-02 referral persistence (real PostgreSQL)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let users: UserRepository;
  let visitors: VisitorRepository;
  let completion: CustomerAuthCompletionService;
  let grants: RedisOtpVerificationGrantStore;
  let redis: Redis;
  let keyPrefix: string;
  let phoneSequence = 0;

  beforeAll(async () => {
    const runId = process.env['EGGSHIP_TEST_RUN_ID'];
    if (!runId) throw new Error('EGGSHIP_TEST_RUN_ID must be set.');
    keyPrefix = redisIntegrationKeyPrefix(runId);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        RedisModule,
        UsersModule,
        AuthModule,
      ],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(new PassThrough())
      .compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UserRepository);
    visitors = moduleRef.get(VisitorRepository);
    completion = moduleRef.get(CustomerAuthCompletionService);
    grants = moduleRef.get(RedisOtpVerificationGrantStore);
    const redisUrl = process.env['TEST_REDIS_URL'];
    if (!redisUrl) throw new Error('TEST_REDIS_URL must be set.');
    redis = moduleRef.get(RedisClientFactory).createQueueClient(redisUrl);
    await app.init();
    await redis.connect();
  });

  beforeEach(async () => {
    await truncateAuthPersistenceTables(prisma);
    await prisma.visitor.deleteMany();
    const keys = await redis.keys(`${OTP_REDIS_KEY_PREFIX}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    const otpKeys = await redis.keys(`${OTP_REDIS_KEY_PREFIX}:*`);
    if (otpKeys.length > 0) await redis.del(...otpKeys);
    const keys = await redis.keys(`${keyPrefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    if (redis.status === 'ready') await redis.quit();
    else redis.disconnect(false);
    await app.close();
  });

  function nextPhone(): string {
    phoneSequence += 1;
    return `+98912${String(Date.now() % 10_000_000).padStart(7, '0')}${String(phoneSequence).slice(-1)}`.slice(
      0,
      13,
    );
  }

  async function grant(phone: string): Promise<string> {
    const grantId = randomUUID();
    await grants.createGrant({
      grantId,
      phone,
      purpose: OTP_PURPOSE_CUSTOMER_AUTH,
      challengeId: randomUUID(),
      ttlSeconds: 600,
      createdAtUnixMs: Date.now(),
    });
    return grantId;
  }

  it('atomically attributes valid new registration and leaves no-code registration unattributed', async () => {
    const visitor = await visitors.create({
      name: 'Referral owner',
      referralCode: 'ABCDEF2345',
    });
    const referredPhone = nextPhone();
    const referred = await completion.completeAuthentication(
      await grant(referredPhone),
      `  ${visitor.referralCode.toLowerCase()} `,
    );
    expect(
      await prisma.referralAttribution.findUnique({
        where: { userId: referred.user.id },
      }),
    ).toMatchObject({
      visitorId: visitor.id,
      referralCode: visitor.referralCode,
    });

    const plain = await completion.completeAuthentication(
      await grant(nextPhone()),
    );
    expect(
      await prisma.referralAttribution.findUnique({
        where: { userId: plain.user.id },
      }),
    ).toBeNull();
  });

  it('rejects invalid and inactive codes without User or attribution residue', async () => {
    const visitor = await visitors.create({
      name: 'Inactive owner',
      referralCode: 'GHIJKL2345',
    });
    await visitors.deactivate(visitor.id);
    const phone = nextPhone();
    await expect(
      completion.completeAuthentication(
        await grant(phone),
        visitor.referralCode,
      ),
    ).rejects.toBeInstanceOf(VisitorInactiveError);
    expect(await users.findByPhone(phone)).toBeNull();
    expect(await prisma.referralAttribution.count()).toBe(0);

    const invalidPhone = nextPhone();
    await expect(
      completion.completeAuthentication(
        await grant(invalidPhone),
        'not-a-code',
      ),
    ).rejects.toMatchObject({ code: 'REFERRAL_CODE_INVALID' });
    expect(await users.findByPhone(invalidPhone)).toBeNull();
  });

  it('allows many distinct Users to use one active Visitor and preserves same-phone semantics', async () => {
    const visitor = await visitors.create({
      name: 'Stampede owner',
      referralCode: 'MNOPQR2345',
    });
    const phones = Array.from({ length: 12 }, () => nextPhone());
    const outcomes = await Promise.allSettled(
      phones.map(async (phone) =>
        completion.completeAuthentication(
          await grant(phone),
          visitor.referralCode,
        ),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(12);
    expect(
      await prisma.referralAttribution.count({
        where: { visitorId: visitor.id },
      }),
    ).toBe(12);

    const samePhone = nextPhone();
    const samePhoneOutcomes = await Promise.allSettled([
      completion.completeAuthentication(
        await grant(samePhone),
        visitor.referralCode,
      ),
      completion.completeAuthentication(
        await grant(samePhone),
        visitor.referralCode,
      ),
    ]);
    expect(
      samePhoneOutcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(await prisma.user.count({ where: { phone: samePhone } })).toBe(1);
    expect(
      await prisma.referralAttribution.count({
        where: { user: { phone: samePhone } },
      }),
    ).toBe(1);
  });

  it('serializes deactivation with registration and preserves historical attribution across lifecycle', async () => {
    const visitor = await visitors.create({
      name: 'Lifecycle owner',
      referralCode: 'STUVWX2345',
    });
    const first = await completion.completeAuthentication(
      await grant(nextPhone()),
      visitor.referralCode,
    );
    await visitors.deactivate(visitor.id);
    expect(
      await prisma.referralAttribution.count({
        where: { visitorId: visitor.id },
      }),
    ).toBe(1);
    await expect(
      completion.completeAuthentication(
        await grant(nextPhone()),
        visitor.referralCode,
      ),
    ).rejects.toBeInstanceOf(VisitorInactiveError);
    const reactivated = await visitors.activate(visitor.id);
    expect(reactivated.referralCode).toBe(visitor.referralCode);
    const second = await completion.completeAuthentication(
      await grant(nextPhone()),
      reactivated.referralCode,
    );
    expect(
      await prisma.referralAttribution.count({
        where: { visitorId: visitor.id },
      }),
    ).toBe(2);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it('makes the registration-before-deactivation serial history explicit with a held Visitor lock', async () => {
    const visitor = await visitors.create({
      name: 'Race owner',
      referralCode: 'EFGHIJ2345',
    });
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let attributionStarted!: () => void;
    const attributionLocked = new Promise<void>((resolve) => {
      attributionStarted = resolve;
    });
    const originalCreateAttribution = visitors.createAttribution.bind(visitors);
    const attributionSpy = jest
      .spyOn(visitors, 'createAttribution')
      .mockImplementation(async (input, tx) => {
        const created = await originalCreateAttribution(input, tx);
        attributionStarted();
        await lockReleased;
        return created;
      });

    const registration = completion.completeAuthentication(
      await grant(nextPhone()),
      visitor.referralCode,
    );
    await attributionLocked;
    const deactivation = visitors.deactivate(visitor.id);
    releaseLock();
    const [registered, deactivated] = await Promise.all([
      registration,
      deactivation,
    ]);
    attributionSpy.mockRestore();

    expect(registered.isNewUser).toBe(true);
    expect(deactivated.isActive).toBe(false);
    expect(
      await prisma.referralAttribution.count({
        where: { visitorId: visitor.id },
      }),
    ).toBe(1);
    await expect(
      completion.completeAuthentication(
        await grant(nextPhone()),
        visitor.referralCode,
      ),
    ).rejects.toBeInstanceOf(VisitorInactiveError);
  });

  it('rejects preferred-code reuse, direct malformed writes, and direct code mutation', async () => {
    const visitor = await visitors.create({
      name: 'Stable owner',
      referralCode: 'YZABCD2345',
    });
    await expect(
      visitors.create({
        name: 'Other owner',
        referralCode: visitor.referralCode.toLowerCase(),
      }),
    ).rejects.toMatchObject({ code: 'REFERRAL_CODE_ALREADY_EXISTS' });
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE "Visitor" SET "referralCode" = ${'BAD'} WHERE "id" = ${visitor.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "Visitor" ("id", "name", "referralCode", "updatedAt") VALUES (${randomUUID()}, ${'Bad'}, ${'BAD'}, CURRENT_TIMESTAMP)`,
      ),
    ).rejects.toThrow();
  });

  it('rolls back User and attribution together when the transaction fails', async () => {
    const visitor = await visitors.create({
      name: 'Rollback owner',
      referralCode: 'CDEFGH2345',
    });
    const phone = nextPhone();
    const attributionSpy = jest
      .spyOn(visitors, 'createAttribution')
      .mockRejectedValue(new Error('forced attribution failure'));
    await expect(
      completion.completeAuthentication(
        await grant(phone),
        visitor.referralCode,
      ),
    ).rejects.toThrow('forced attribution failure');
    expect(await users.findByPhone(phone)).toBeNull();
    expect(await prisma.referralAttribution.count()).toBe(0);
    attributionSpy.mockRestore();
  });
});
