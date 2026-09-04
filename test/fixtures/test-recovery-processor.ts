import {
  AsyncFailureCategory,
  type RecoveryProcessor,
  type ReplayExecutionResult,
} from '../../src/modules/async-recovery/domain/async-recovery';

export type TestReplayMode = 'success' | 'transient' | 'permanent';

/** The test harness supplies a real durable implementation, normally backed by PostgreSQL. */
export interface DurableTestReplayState {
  hasApplied(key: string): Promise<boolean>;
  applyOnce(key: string): Promise<void>;
}

/** Test-only processor; it is intentionally not imported by any application module. */
export class TestRecoveryProcessor implements RecoveryProcessor {
  readonly identity = 'test.recovery.v1';
  readonly queueName = 'test-recovery';
  readonly jobName = 'test.recovery';
  readonly eventType = 'test.recovery.requested';
  readonly eventVersion = 1;
  readonly replaySafe = true;
  readonly idempotencyDescription = 'durable state keyed by replay id';

  constructor(
    private readonly state: DurableTestReplayState,
    private readonly mode: TestReplayMode = 'success',
  ) {}

  async executeReplay(input: {
    replayId: string;
    eventType: string;
    eventVersion: number;
    payload: Record<string, unknown>;
  }): Promise<ReplayExecutionResult> {
    if (this.mode === 'transient') {
      throw Object.assign(new Error('test transient failure'), {
        category: AsyncFailureCategory.PROVIDER_TRANSIENT,
        reasonCode: 'test_transient_failure',
        retryable: true,
      });
    }
    if (this.mode === 'permanent') {
      throw Object.assign(new Error('test permanent failure'), {
        category: AsyncFailureCategory.PROVIDER_PERMANENT,
        reasonCode: 'test_permanent_failure',
        retryable: false,
      });
    }
    if (!(await this.state.hasApplied(input.replayId))) {
      await this.state.applyOnce(input.replayId);
    }
    return {
      outcome: 'SUCCEEDED',
      attemptedAt: new Date(),
      processorIdentity: this.identity,
      releaseIdentity: 'test-release',
    };
  }
}
