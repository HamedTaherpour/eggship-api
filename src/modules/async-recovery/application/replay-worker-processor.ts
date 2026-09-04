import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import type { WorkerProcessor } from '../../../infrastructure/worker/worker.types';
import type { AsyncRecoveryService } from './async-recovery.service';
import {
  classifyProcessorFailure,
  type RecoveryProcessor,
} from '../domain/async-recovery';

type ReplayJobData = {
  replayId: string;
  failureId: string;
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/**
 * Explicit adapter for approved replay processors. It is not registered by
 * WorkerAppModule; tests or a future approved processor composition root must
 * provide the adapter explicitly.
 */
export class ReplayWorkerProcessor implements WorkerProcessor {
  readonly identity: string;
  readonly queueName: string;
  readonly jobName: string;

  constructor(
    private readonly processor: RecoveryProcessor,
    private readonly recovery: AsyncRecoveryService,
    private readonly config: ConfigService,
  ) {
    this.identity = processor.identity;
    this.queueName = processor.queueName;
    this.jobName = processor.jobName;
  }

  async process(job: Job): Promise<void> {
    const data = this.asReplayData(job.data);
    if (
      data === undefined ||
      data.eventType !== this.processor.eventType ||
      data.eventVersion !== this.processor.eventVersion ||
      !this.processor.replaySafe ||
      this.processor.executeReplay === undefined
    ) {
      return;
    }

    // This also makes PUBLISHED -> RUNNING the durable execution gate. A
    // duplicate delivery, a terminal replay, or a concurrent worker exits.
    const claimed = await this.recovery.beginReplayExecution(data.replayId);
    if (!claimed) return;

    const attemptedAt = new Date();
    try {
      const result = await this.processor.executeReplay({
        replayId: data.replayId,
        eventType: data.eventType,
        eventVersion: data.eventVersion,
        payload: data.payload,
      });
      await this.recovery.recordReplayResult(data.replayId, {
        outcome: 'SUCCEEDED',
        attemptedAt: result.attemptedAt ?? attemptedAt,
        processorIdentity: this.identity,
        releaseIdentity: this.releaseIdentity(),
      });
    } catch (error: unknown) {
      await this.recovery.recordReplayResult(data.replayId, {
        outcome: 'FAILED',
        attemptedAt,
        processorIdentity: this.identity,
        releaseIdentity: this.releaseIdentity(),
        failure: classifyProcessorFailure(error),
      });
    }
  }

  private asReplayData(value: unknown): ReplayJobData | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = value as { data?: unknown };
    if (typeof candidate.data !== 'object' || candidate.data === null)
      return undefined;
    const data = candidate.data as Record<string, unknown>;
    if (
      typeof data.replayId !== 'string' ||
      typeof data.eventType !== 'string' ||
      typeof data.eventVersion !== 'number' ||
      typeof data.payload !== 'object' ||
      data.payload === null ||
      Array.isArray(data.payload)
    )
      return undefined;
    return data as unknown as ReplayJobData;
  }

  private releaseIdentity(): string {
    return (
      this.config.get<string>('GIT_SHA') ??
      this.config.get<string>('APP_VERSION') ??
      'unknown'
    );
  }
}
