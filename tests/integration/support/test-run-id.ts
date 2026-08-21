import { randomBytes } from 'node:crypto';

/**
 * Collision-resistant id for parallel CI workers and concurrent local runs.
 */
export function createTestRunId(
  now: Date = new Date(),
  random: () => string = () => randomBytes(4).toString('hex'),
): string {
  return `${now.getTime().toString(36)}-${process.pid.toString(36)}-${random()}`;
}

export function redisIntegrationKeyPrefix(testRunId: string): string {
  return `eggship:integration:${testRunId}`;
}

export function bullmqIntegrationQueueName(testRunId: string): string {
  return `eggship:integration:q:${testRunId}`;
}
