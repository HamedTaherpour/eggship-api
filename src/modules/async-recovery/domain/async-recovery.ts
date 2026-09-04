export const AsyncFailureCategory = {
  INFRASTRUCTURE_TRANSIENT: 'INFRASTRUCTURE_TRANSIENT',
  PROVIDER_TRANSIENT: 'PROVIDER_TRANSIENT',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_PERMANENT: 'PROVIDER_PERMANENT',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  BUSINESS_REJECTION: 'BUSINESS_REJECTION',
  PROCESSOR_TIMEOUT: 'PROCESSOR_TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;
export type AsyncFailureCategory =
  (typeof AsyncFailureCategory)[keyof typeof AsyncFailureCategory];

export type ProcessorFailure = {
  category: AsyncFailureCategory;
  reasonCode: string;
  retryable: boolean;
};

export type ReplayExecutionResult =
  | {
      outcome: 'SUCCEEDED';
      attemptedAt: Date;
      processorIdentity: string;
      releaseIdentity: string;
    }
  | {
      outcome: 'FAILED';
      attemptedAt: Date;
      processorIdentity: string;
      releaseIdentity: string;
      failure: ProcessorFailure;
    };

export function classifyProcessorFailure(error: unknown): ProcessorFailure {
  if (isProcessorFailure(error)) return error;
  return {
    category: AsyncFailureCategory.UNKNOWN,
    reasonCode: 'processor_failed',
    retryable: false,
  };
}

function isProcessorFailure(value: unknown): value is ProcessorFailure {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.category === 'string' &&
    Object.values(AsyncFailureCategory).includes(
      candidate.category as AsyncFailureCategory,
    ) &&
    typeof candidate.reasonCode === 'string' &&
    /^[a-z][a-z0-9_.-]{0,63}$/u.test(candidate.reasonCode) &&
    typeof candidate.retryable === 'boolean'
  );
}

export interface RecoveryProcessor {
  readonly identity: string;
  readonly queueName: string;
  readonly jobName: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly replaySafe: boolean;
  readonly idempotencyDescription: string;
  executeReplay?(input: {
    replayId: string;
    outboxEventId?: string;
    eventType: string;
    eventVersion: number;
    payload: Record<string, unknown>;
  }): Promise<ReplayExecutionResult>;
}

export const RECOVERY_PROCESSORS = Symbol('RECOVERY_PROCESSORS');
