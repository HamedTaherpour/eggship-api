import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../src/generated/prisma/client';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import { AsyncRecoveryService } from '../../../src/modules/async-recovery/application/async-recovery.service';
import { AsyncRecoveryRepository } from '../../../src/modules/async-recovery/infrastructure/async-recovery.repository';
import { RECOVERY_PROCESSORS } from '../../../src/modules/async-recovery/domain/async-recovery';
import { AsyncFailureCategory } from '../../../src/modules/async-recovery/domain/async-recovery';
import type { RecoveryProcessor } from '../../../src/modules/async-recovery/domain/async-recovery';

describe('ASY-04 async recovery PostgreSQL contract (integration)', () => {
  let prisma: PrismaService;
  let recovery: AsyncRecoveryService;
  let audit: AuditLogService;
  const createdOutboxIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        PrismaModule,
        AuditModule,
        ObservabilityModule,
      ],
      providers: [
        AsyncRecoveryRepository,
        AsyncRecoveryService,
        { provide: RECOVERY_PROCESSORS, useValue: [processor()] },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    recovery = moduleRef.get(AsyncRecoveryService);
    audit = moduleRef.get(AuditLogService);
  });

  afterEach(async () => {
    for (const outboxEventId of createdOutboxIds.splice(0)) {
      const failures = await prisma.asyncFailure.findMany({
        where: { outboxEventId },
        select: { id: true },
      });
      const failureIds = failures.map(({ id }) => id);
      await prisma.asyncReplay.deleteMany({
        where: { failureId: { in: failureIds } },
      });
      await prisma.asyncFailure.deleteMany({
        where: { id: { in: failureIds } },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: outboxEventId } });
      await prisma.auditLog.deleteMany({
        where: { correlationId: { startsWith: 'asy04_' } },
      });
    }
  });

  afterAll(async () => {
    if (prisma !== undefined) await prisma.$disconnect();
  });

  it('persists only normalized failure metadata and protects durable history', async () => {
    const fixture = await createFixture();
    const failure = await new AsyncRecoveryRepository(prisma).upsertFailure({
      outboxEventId: fixture.outboxId,
      processorIdentity: 'test.recovery.v1',
      queueName: 'test-recovery',
      jobName: 'test.recovery',
      jobId: 'job-1',
      eventType: 'test.recovery.requested',
      eventVersion: 1,
      correlationId: fixture.correlationId,
      attemptCount: 3,
      category: AsyncFailureCategory.PROVIDER_TRANSIENT,
      reasonCode: 'provider_timeout',
      applicationVersion: 'test-release',
    });
    expect(failure).toMatchObject({
      category: 'PROVIDER_TRANSIENT',
      reasonCode: 'provider_timeout',
    });
    expect(JSON.stringify(failure)).not.toMatch(
      /raw|payload|stack|authorization|provider response|secret|token|email|phone/iu,
    );
    await expect(
      prisma.outboxEvent.delete({ where: { id: fixture.outboxId } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('creates exactly one active replay under concurrent requests and audits atomically', async () => {
    const fixture = await createFixture();
    const repository = new AsyncRecoveryRepository(prisma);
    await repository.upsertFailure({
      outboxEventId: fixture.outboxId,
      processorIdentity: 'test.recovery.v1',
      queueName: 'test-recovery',
      jobName: 'test.recovery',
      eventType: 'test.recovery.requested',
      eventVersion: 1,
      correlationId: fixture.correlationId,
      attemptCount: 1,
      category: AsyncFailureCategory.UNKNOWN,
      reasonCode: 'job_failed',
    });
    const failure = await prisma.asyncFailure.findFirstOrThrow({
      where: { outboxEventId: fixture.outboxId },
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recovery.replay(failure.id, fixture.actorId),
      ),
    );
    expect(
      new Set(results.map((result) => (result as { id: string }).id)).size,
    ).toBe(1);
    expect(
      await prisma.asyncReplay.count({ where: { failureId: failure.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: failure.id, action: 'async.replay.requested' },
      }),
    ).toBe(1);
  });

  it('keeps lifecycle transitions and execution receipts idempotent', async () => {
    const fixture = await createFixture();
    const repository = new AsyncRecoveryRepository(prisma);
    await repository.upsertFailure({
      outboxEventId: fixture.outboxId,
      processorIdentity: 'test.recovery.v1',
      queueName: 'test-recovery',
      jobName: 'test.recovery',
      eventType: 'test.recovery.requested',
      eventVersion: 1,
      correlationId: fixture.correlationId,
      attemptCount: 1,
      category: AsyncFailureCategory.UNKNOWN,
      reasonCode: 'job_failed',
    });
    const failure = await prisma.asyncFailure.findFirstOrThrow({
      where: { outboxEventId: fixture.outboxId },
    });
    const replay = (await recovery.replay(failure.id, fixture.actorId)) as {
      id: string;
    };
    await prisma.asyncReplay.update({
      where: { id: replay.id },
      data: { status: 'PUBLISHED' },
    });
    expect(
      await Promise.all([
        recovery.beginReplayExecution(replay.id),
        recovery.beginReplayExecution(replay.id),
      ]),
    ).toEqual([true, false]);
    const receipt = await recovery.recordReplayResult(replay.id, {
      outcome: 'FAILED',
      attemptedAt: new Date(),
      processorIdentity: 'test.recovery.v1',
      releaseIdentity: 'release-1',
      failure: {
        category: AsyncFailureCategory.PROVIDER_TRANSIENT,
        reasonCode: 'provider_timeout',
        retryable: true,
      },
    });
    expect(receipt).toMatchObject({
      status: 'FAILED',
      resultCategory: 'PROVIDER_TRANSIENT',
      failureReasonCode: 'provider_timeout',
      releaseIdentity: 'release-1',
    });
    expect(
      await recovery.recordReplayResult(replay.id, {
        outcome: 'SUCCEEDED',
        attemptedAt: new Date(),
        processorIdentity: 'test.recovery.v1',
        releaseIdentity: 'release-2',
      }),
    ).toBeNull();
  });

  it('rejects quarantined and unsupported replays, and rolls back a mutation when audit fails', async () => {
    const fixture = await createFixture();
    const repository = new AsyncRecoveryRepository(prisma);
    await repository.upsertFailure({
      outboxEventId: fixture.outboxId,
      processorIdentity: 'unknown',
      queueName: 'q',
      jobName: 'j',
      eventType: 'unknown.event',
      eventVersion: 1,
      correlationId: fixture.correlationId,
      attemptCount: 1,
      category: AsyncFailureCategory.UNKNOWN,
      reasonCode: 'unknown_processor',
    });
    const unsupported = await prisma.asyncFailure.findFirstOrThrow({
      where: { outboxEventId: fixture.outboxId },
    });
    await expect(
      recovery.replay(unsupported.id, fixture.actorId),
    ).rejects.toThrow('ASYNC_REPLAY_UNSUPPORTED');
    await recovery.mutate(unsupported.id, 'quarantine', fixture.actorId);
    await expect(
      recovery.replay(unsupported.id, fixture.actorId),
    ).rejects.toThrow('ASYNC_FAILURE_REPLAY_BLOCKED');

    const auditAppend = jest
      .spyOn(audit, 'append')
      .mockRejectedValueOnce(new Error('injected audit failure'));
    await expect(
      recovery.mutate(unsupported.id, 'unquarantine', fixture.actorId),
    ).rejects.toThrow('injected audit failure');
    expect(
      (
        await prisma.asyncFailure.findUniqueOrThrow({
          where: { id: unsupported.id },
        })
      ).quarantinedAt,
    ).not.toBeNull();
    auditAppend.mockRestore();
  });

  async function createFixture(): Promise<{
    outboxId: string;
    actorId: string;
    correlationId: string;
  }> {
    const outboxId = randomUUID();
    const correlationId = `asy04_${randomUUID()}`;
    createdOutboxIds.push(outboxId);
    await prisma.outboxEvent.create({
      data: {
        id: outboxId,
        eventType: 'test.recovery.requested',
        eventVersion: 1,
        correlationId,
        occurredAt: new Date(),
        payload: { safeReference: 'fixture' },
      },
    });
    return { outboxId, actorId: randomUUID(), correlationId };
  }
});

function processor(): RecoveryProcessor {
  return {
    identity: 'test.recovery.v1',
    queueName: 'test-recovery',
    jobName: 'test.recovery',
    eventType: 'test.recovery.requested',
    eventVersion: 1,
    replaySafe: true,
    idempotencyDescription: 'test',
    executeReplay: jest.fn(),
  };
}
