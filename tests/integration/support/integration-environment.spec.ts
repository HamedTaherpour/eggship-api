import {
  applyIntegrationEnvironment,
  assertDestructiveOperationsAllowed,
  IntegrationEnvironmentError,
  pickIntegrationKeys,
  resolveIntegrationEnvironment,
} from './integration-environment';

describe('integration environment guards', () => {
  it('refuses to run without INTEGRATION_TESTS_ENABLED=true', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'postgres',
        env: {
          TEST_DATABASE_URL:
            'postgresql://test:test@127.0.0.1:5432/eggship_test',
        },
      }),
    ).toThrow(IntegrationEnvironmentError);
  });

  it('does not fall back to DATABASE_URL when TEST_DATABASE_URL is missing', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'postgres',
        env: {
          INTEGRATION_TESTS_ENABLED: 'true',
          DATABASE_URL: 'postgresql://dev:dev@127.0.0.1:5432/eggship_dev',
        },
      }),
    ).toThrow(/TEST_DATABASE_URL/u);
  });

  it('does not fall back to REDIS_URL when TEST_REDIS_URL is missing', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'redis',
        env: {
          INTEGRATION_TESTS_ENABLED: 'true',
          REDIS_URL: 'redis://127.0.0.1:6379',
        },
      }),
    ).toThrow(/TEST_REDIS_URL/u);
  });

  it('rejects the synthetic unit/e2e database URL', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'postgres',
        env: {
          INTEGRATION_TESTS_ENABLED: 'true',
          TEST_DATABASE_URL: 'postgresql://example.invalid/eggship_test',
        },
      }),
    ).toThrow(/synthetic unit\/e2e/u);
  });

  it('rejects non-routable .invalid hosts', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'redis',
        env: {
          INTEGRATION_TESTS_ENABLED: 'true',
          TEST_REDIS_URL: 'redis://cache.invalid:6379',
        },
      }),
    ).toThrow(/\.invalid/u);
  });

  it('rejects explicitly production-marked host labels', () => {
    expect(() =>
      resolveIntegrationEnvironment({
        suite: 'postgres',
        env: {
          INTEGRATION_TESTS_ENABLED: 'true',
          TEST_DATABASE_URL:
            'postgresql://u:p@db.production.example.com:5432/eggship',
        },
      }),
    ).toThrow(/production-marked/u);
  });

  it('resolves dedicated TEST targets and maps them for Nest/Prisma/Redis', () => {
    const env: NodeJS.ProcessEnv = {
      INTEGRATION_TESTS_ENABLED: 'true',
      TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/eggship_it',
      TEST_REDIS_URL: 'redis://127.0.0.1:6379/1',
    };
    const resolved = resolveIntegrationEnvironment({
      suite: 'all',
      env,
      testRunId: 'run_fixed',
    });

    expect(resolved.databaseUrl).toBe(
      'postgresql://test:test@127.0.0.1:5432/eggship_it',
    );
    expect(resolved.redisUrl).toBe('redis://127.0.0.1:6379/1');
    expect(resolved.databaseMetadata).toEqual({
      protocol: 'postgresql',
      host: '127.0.0.1',
      port: '5432',
      path: '/eggship_it',
    });

    applyIntegrationEnvironment(resolved, env);
    expect(env['DATABASE_URL']).toBe(resolved.databaseUrl);
    expect(env['REDIS_URL']).toBe(resolved.redisUrl);
    expect(env['EGGSHIP_TEST_RUN_ID']).toBe('run_fixed');
  });

  it('requires an extra opt-in for destructive operations', () => {
    expect(() =>
      assertDestructiveOperationsAllowed({
        INTEGRATION_TESTS_ENABLED: 'true',
      }),
    ).toThrow(/INTEGRATION_ALLOW_DESTRUCTIVE=true/u);

    expect(() =>
      assertDestructiveOperationsAllowed({
        INTEGRATION_TESTS_ENABLED: 'true',
        INTEGRATION_ALLOW_DESTRUCTIVE: 'true',
      }),
    ).not.toThrow();
  });

  it('only picks integration keys from an env file map', () => {
    expect(
      pickIntegrationKeys({
        INTEGRATION_TESTS_ENABLED: 'true',
        TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/eggship_it',
        DATABASE_URL: 'postgresql://dev:dev@127.0.0.1:5432/eggship_dev',
        REDIS_URL: 'redis://127.0.0.1:6379',
        TEST_REDIS_URL: 'redis://127.0.0.1:6380',
        NODE_ENV: 'development',
      }),
    ).toEqual({
      INTEGRATION_TESTS_ENABLED: 'true',
      TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/eggship_it',
      TEST_REDIS_URL: 'redis://127.0.0.1:6380',
    });
  });
});
