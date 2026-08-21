import type { DefaultJobOptions } from 'bullmq';

export const QUEUE_PAYLOAD_SIZE_LIMIT_BYTES = 65_536;

export const DEFAULT_JOB_OPTIONS: Readonly<DefaultJobOptions> = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
  keepLogs: 100,
  stackTraceLimit: 10,
  sizeLimit: QUEUE_PAYLOAD_SIZE_LIMIT_BYTES,
};

export interface WorkerRuntimePolicy {
  concurrency: number;
  lockDurationMs: number;
}

export const DEFAULT_WORKER_RUNTIME_POLICY: Readonly<WorkerRuntimePolicy> = {
  concurrency: 5,
  lockDurationMs: 30_000,
};

export function buildDefaultJobOptions(
  overrides: DefaultJobOptions = {},
): DefaultJobOptions {
  return { ...DEFAULT_JOB_OPTIONS, ...overrides };
}

export function buildWorkerRuntimePolicy(
  overrides: Partial<WorkerRuntimePolicy> = {},
): WorkerRuntimePolicy {
  const policy = { ...DEFAULT_WORKER_RUNTIME_POLICY, ...overrides };
  if (!Number.isInteger(policy.concurrency) || policy.concurrency < 1) {
    throw new Error('Worker concurrency must be a positive integer.');
  }
  if (!Number.isInteger(policy.lockDurationMs) || policy.lockDurationMs < 1) {
    throw new Error('Worker lock duration must be a positive integer.');
  }
  return policy;
}
