import { validateWorkerEnvironment } from './worker-environment.validation';

const valid = {
  NODE_ENV: 'test',
  APP_VERSION: '0.1.0',
  GIT_SHA: 'test',
  REDIS_URL: 'redis://127.0.0.1:6380',
  DATABASE_URL: 'postgresql://127.0.0.1:5432/eggship_test',
  FCM_PROJECT_ID: 'test-project',
  FCM_CLIENT_EMAIL: 'worker@test-project.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY----- test -----END PRIVATE KEY-----',
};

describe('validateWorkerEnvironment', () => {
  it('requires Redis and provides bounded defaults', () => {
    expect(validateWorkerEnvironment(valid)).toMatchObject({
      REDIS_URL: valid.REDIS_URL,
      WORKER_CONCURRENCY: 5,
      WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
    });
    expect(() =>
      validateWorkerEnvironment({ ...valid, REDIS_URL: '' }),
    ).toThrow('REDIS_URL is required.');
  });

  it('rejects unsafe runtime bounds', () => {
    expect(() =>
      validateWorkerEnvironment({ ...valid, WORKER_CONCURRENCY: '0' }),
    ).toThrow('WORKER_CONCURRENCY must be an integer between 1 and 100.');
    expect(() =>
      validateWorkerEnvironment({
        ...valid,
        WORKER_SHUTDOWN_TIMEOUT_MS: '500',
      }),
    ).toThrow(
      'WORKER_SHUTDOWN_TIMEOUT_MS must be an integer between 1000 and 300000.',
    );
  });
});
