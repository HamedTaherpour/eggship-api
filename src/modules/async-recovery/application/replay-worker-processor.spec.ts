import type { ConfigService } from '@nestjs/config';
import { ReplayWorkerProcessor } from './replay-worker-processor';
import type { RecoveryProcessor } from '../domain/async-recovery';
import type { AsyncRecoveryService } from './async-recovery.service';

describe('ReplayWorkerProcessor', () => {
  const executeReplay = jest.fn();
  const processor: RecoveryProcessor = {
    identity: 'test.processor',
    queueName: 'test-queue',
    jobName: 'test-job',
    eventType: 'test.event',
    eventVersion: 1,
    replaySafe: true,
    idempotencyDescription: 'durable test state',
    executeReplay: executeReplay.mockResolvedValue({
      outcome: 'SUCCEEDED',
      attemptedAt: new Date(),
      processorIdentity: 'test.processor',
      releaseIdentity: 'test',
    }),
  };
  const beginReplayExecution = jest.fn().mockResolvedValue(true);
  const recordReplayResult = jest.fn().mockResolvedValue(undefined);
  const recovery = {
    beginReplayExecution,
    recordReplayResult,
  } as unknown as AsyncRecoveryService;
  const adapter = new ReplayWorkerProcessor(processor, recovery, {
    get: jest.fn().mockReturnValue('test'),
  } as unknown as ConfigService);

  it('runs a replay only after winning the durable execution gate', async () => {
    await adapter.process({
      data: {
        metadata: {
          schemaVersion: 1,
          correlationId: 'test.correlation',
          enqueuedAt: new Date().toISOString(),
        },
        data: {
          replayId: 'replay-1',
          failureId: 'failure-1',
          outboxEventId: 'outbox-1',
          eventType: 'test.event',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: { value: 'safe' },
        },
      },
    } as never);
    expect(executeReplay).toHaveBeenCalledTimes(1);
    expect(recordReplayResult).toHaveBeenCalledWith(
      'replay-1',
      expect.objectContaining({ outcome: 'SUCCEEDED' }),
    );
  });

  it('does not execute a duplicate after losing the durable gate', async () => {
    beginReplayExecution.mockResolvedValueOnce(false);
    await adapter.process({ data: {} } as never);
    expect(executeReplay).toHaveBeenCalledTimes(1);
  });
});
