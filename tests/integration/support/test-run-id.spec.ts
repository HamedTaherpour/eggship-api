import {
  bullmqIntegrationQueueName,
  createTestRunId,
  redisIntegrationKeyPrefix,
} from './test-run-id';

describe('integration test-run id helpers', () => {
  it('builds Redis key prefixes and BullMQ-safe queue names', () => {
    const testRunId = createTestRunId(
      new Date('2026-01-01T00:00:00.000Z'),
      () => 'abcd',
    );
    expect(redisIntegrationKeyPrefix(testRunId)).toMatch(
      /^eggship:integration:/u,
    );
    const queueName = bullmqIntegrationQueueName(testRunId);
    expect(queueName).toMatch(/^eggship-integration-q-/u);
    expect(queueName.includes(':')).toBe(false);
  });
});
