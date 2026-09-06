import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  buildK6Arguments,
  buildK6Environment,
} from '../../../scripts/run-load-test.mjs';

const runner = 'scripts/run-load-test.mjs';
const base = {
  ...process.env,
  LOAD_TESTS_ENABLED: 'true',
  LOAD_TEST_ENV: 'local',
  LOAD_TEST_BASE_URL: 'http://127.0.0.1:3000',
};
function rejects(overrides, text) {
  assert.throws(
    () =>
      execFileSync(process.execPath, [runner, 'smoke'], {
        env: { ...base, ...overrides },
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (error) => new RegExp(text).test(String(error.stderr)),
  );
}

describe('REL-03 load-test safety', () => {
  it('propagates the sanitized base URL to the k6 child environment', () => {
    const environment = buildK6Environment(
      {
        baseUrl: 'http://127.0.0.1:3000',
        environment: 'local',
        name: 'smoke',
        vus: 2,
        duration: '20s',
        artifactStamp: 'test-stamp',
      },
      {
        ...base,
        LOAD_TEST_BASE_URL:
          'https://user:secret@staging.example.test/path?token=x',
      },
    );
    assert.equal(environment.LOAD_TEST_BASE_URL, 'http://127.0.0.1:3000');
  });
  it('passes non-secret runtime metadata explicitly at the k6 CLI boundary', () => {
    const config = {
      baseUrl: 'http://127.0.0.1:3000',
      environment: 'local',
      name: 'smoke',
      vus: 2,
      duration: '20s',
      artifactStamp: 'test-stamp',
    };
    const environment = buildK6Environment(config, {
      ...base,
      GIT_SHA: 'local',
      APP_VERSION: '0.1.0',
    });
    const args = buildK6Arguments(
      { ...config, ...environment },
      'tests/performance/rel-03/smoke.js',
    );
    assert.deepEqual(args, [
      'run',
      '--vus',
      '2',
      '--duration',
      '20s',
      '--include-system-env-vars',
      '-e',
      'LOAD_TEST_BASE_URL=http://127.0.0.1:3000',
      '-e',
      'LOAD_TEST_ENV=local',
      '-e',
      'LOAD_TEST_SCENARIO=smoke',
      '-e',
      'LOAD_TEST_VUS=2',
      '-e',
      'LOAD_TEST_DURATION=20s',
      '-e',
      'LOAD_TEST_ARTIFACT_STAMP=test-stamp',
      '-e',
      'GIT_SHA=local',
      '-e',
      'APP_VERSION=0.1.0',
      'tests/performance/rel-03/smoke.js',
    ]);
    assert.doesNotMatch(args.join(' '), /secret|token|authorization/i);
  });
  it('rejects disabled or missing environment configuration', () => {
    rejects({ LOAD_TESTS_ENABLED: 'false' }, 'LOAD_TESTS_ENABLED');
    rejects({ LOAD_TEST_ENV: '' }, 'LOAD_TEST_ENV');
  });
  it('rejects production-like and non-loopback local targets', () => {
    rejects(
      { LOAD_TEST_BASE_URL: 'https://production.example.test' },
      'production-like',
    );
    rejects({ LOAD_TEST_BASE_URL: 'https://staging.example.test' }, 'loopback');
  });
  it('requires explicit approval for staging and rejects reset requests', () => {
    rejects(
      {
        LOAD_TEST_ENV: 'staging',
        LOAD_TEST_BASE_URL: 'https://staging.example.test',
      },
      'RUNNER_APPROVED',
    );
    rejects({ LOAD_TEST_RESET: 'true' }, 'reset/reseed');
  });
});
