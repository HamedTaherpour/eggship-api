import { validateEnvironment } from '../../../src/config/environment.validation';
import { validateWorkerEnvironment } from '../../../src/config/worker-environment.validation';

describe('NOT-05 startup boundary proof (integration)', () => {
  it('allows API configuration without FCM credentials', () => {
    const values = { ...process.env } as Record<string, unknown>;
    delete values.FCM_PROJECT_ID;
    delete values.FCM_CLIENT_EMAIL;
    delete values.FCM_PRIVATE_KEY;
    expect(() => validateEnvironment(values)).not.toThrow();
  });

  it('requires every production worker credential and infrastructure boundary', () => {
    const values = workerValues();
    for (const key of [
      'FCM_PROJECT_ID',
      'FCM_CLIENT_EMAIL',
      'FCM_PRIVATE_KEY',
      'REDIS_URL',
      'DATABASE_URL',
    ]) {
      const candidate = { ...values };
      delete candidate[key];
      expect(() => validateWorkerEnvironment(candidate)).toThrow(key);
    }
    expect(() => validateWorkerEnvironment(values)).not.toThrow();
  });
});

function workerValues(): Record<string, unknown> {
  return {
    NODE_ENV: 'test',
    APP_VERSION: '0.1.0-integration',
    GIT_SHA: 'integration',
    DATABASE_URL: 'postgresql://example.invalid/eggship_test',
    REDIS_URL: 'redis://127.0.0.1:6379/1',
    FCM_PROJECT_ID: 'not05-project',
    FCM_CLIENT_EMAIL: 'not05@example.invalid',
    FCM_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nnot05\\n-----END PRIVATE KEY-----',
    WORKER_CONCURRENCY: 5,
    WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
  };
}
