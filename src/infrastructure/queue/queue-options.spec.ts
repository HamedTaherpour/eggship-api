import {
  DEFAULT_JOB_OPTIONS,
  DEFAULT_WORKER_RUNTIME_POLICY,
  buildDefaultJobOptions,
  buildWorkerRuntimePolicy,
} from './queue-options';

describe('queue options', () => {
  it('provides bounded retry, backoff, retention, and payload defaults', () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
      keepLogs: 100,
      stackTraceLimit: 10,
      sizeLimit: 65_536,
    });
  });

  it('allows deliberate per-queue overrides without changing defaults', () => {
    expect(buildDefaultJobOptions({ attempts: 5 })).toMatchObject({
      attempts: 5,
      keepLogs: 100,
    });
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
  });

  it('validates worker concurrency and lock-duration overrides', () => {
    expect(buildWorkerRuntimePolicy({ concurrency: 2 })).toEqual({
      ...DEFAULT_WORKER_RUNTIME_POLICY,
      concurrency: 2,
    });
    expect(() => buildWorkerRuntimePolicy({ concurrency: 0 })).toThrow(
      'Worker concurrency must be a positive integer.',
    );
    expect(() => buildWorkerRuntimePolicy({ lockDurationMs: 1.5 })).toThrow(
      'Worker lock duration must be a positive integer.',
    );
  });
});
