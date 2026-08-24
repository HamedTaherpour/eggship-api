#!/usr/bin/env node
'use strict';

/**
 * Opt-in real-infrastructure integration test runner.
 * Fails closed when INTEGRATION_TESTS_ENABLED / TEST_* configuration is missing.
 * Does not reuse DATABASE_URL or REDIS_URL as integration targets.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const suite = parseSuite(process.argv);
const env = { ...process.env };

mergeIntegrationKeysFromDotEnv(env, suite);
assertEnabled(env);
assertSuiteTargets(env, suite);

if (suite === 'all' || suite === 'postgres') {
  runMigrations(env);
}

env['INTEGRATION_SUITE'] = suite;
env['NODE_ENV'] = 'test';
if (suite === 'redis') {
  // Config validation requires DATABASE_URL, but Redis-only tests must not
  // inherit runtime PostgreSQL credentials or contact PostgreSQL.
  env['DATABASE_URL'] = 'postgresql://example.invalid/eggship_test';
}

const jestArgs = [
  'exec',
  'jest',
  '--config',
  'jest.integration.config.ts',
  '--runInBand',
];

const result = spawnSync('pnpm', jestArgs, {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status === null ? 1 : result.status);

function parseSuite(argv) {
  const suiteArg = argv.find((value) => value.startsWith('--suite='));
  if (suiteArg === undefined) {
    return 'all';
  }
  const value = suiteArg.slice('--suite='.length);
  if (
    value === 'all' ||
    value === 'postgres' ||
    value === 'redis' ||
    value === 'storage'
  ) {
    return value;
  }
  fail(
    `Unknown suite '${value}'. Use --suite=all, --suite=postgres, --suite=redis, or --suite=storage.`,
  );
}

function mergeIntegrationKeysFromDotEnv(env, suiteName) {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const values = parseEnvFile(readFileSync(envPath, 'utf8'));
  if (suiteName === 'all' || suiteName === 'redis') {
    assertDistinctRedisTargets({
      REDIS_URL: effectiveEnvValue(env['REDIS_URL'], values['REDIS_URL']),
      TEST_REDIS_URL: effectiveEnvValue(
        env['TEST_REDIS_URL'],
        values['TEST_REDIS_URL'],
      ),
    });
  }
  for (const key of [
    'INTEGRATION_TESTS_ENABLED',
    'INTEGRATION_ALLOW_DESTRUCTIVE',
    'TEST_DATABASE_URL',
    'TEST_REDIS_URL',
    'TEST_STORAGE_ENDPOINT',
    'TEST_STORAGE_BUCKET',
    'TEST_STORAGE_ACCESS_KEY',
    'TEST_STORAGE_SECRET_KEY',
    'TEST_STORAGE_REGION',
    'TEST_STORAGE_PUBLIC_BASE_URL',
  ]) {
    if (
      (env[key] === undefined || env[key] === '') &&
      typeof values[key] === 'string' &&
      values[key].trim() !== ''
    ) {
      env[key] = values[key].trim();
    }
  }
}

function assertEnabled(env) {
  if (env['INTEGRATION_TESTS_ENABLED']?.trim() !== 'true') {
    fail(
      'Integration tests require INTEGRATION_TESTS_ENABLED=true. Ordinary pnpm test / pnpm test:e2e remain infrastructure-free.',
    );
  }
}

function assertSuiteTargets(env, suiteName) {
  const needsDatabase = suiteName === 'all' || suiteName === 'postgres';
  const needsRedis = suiteName === 'all' || suiteName === 'redis';
  const needsStorage = suiteName === 'storage';
  if (needsRedis) {
    assertDistinctRedisTargets(env);
  }

  if (
    needsDatabase &&
    !hasValue(env['TEST_DATABASE_URL']) &&
    hasValue(env['DATABASE_URL'])
  ) {
    fail(
      'Refusing to use DATABASE_URL for integration tests. Set TEST_DATABASE_URL.',
    );
  }
  if (
    needsRedis &&
    !hasValue(env['TEST_REDIS_URL']) &&
    hasValue(env['REDIS_URL'])
  ) {
    fail(
      'Refusing to use REDIS_URL for integration tests. Set TEST_REDIS_URL.',
    );
  }
  if (needsDatabase && !hasValue(env['TEST_DATABASE_URL'])) {
    fail(
      'TEST_DATABASE_URL is required for this integration suite and must point at dedicated non-production PostgreSQL.',
    );
  }
  if (needsRedis && !hasValue(env['TEST_REDIS_URL'])) {
    fail(
      'TEST_REDIS_URL is required for this integration suite and must point at dedicated non-production Redis.',
    );
  }
  if (
    needsDatabase &&
    env['TEST_DATABASE_URL'] === 'postgresql://example.invalid/eggship_test'
  ) {
    fail(
      'TEST_DATABASE_URL must not reuse the synthetic unit/e2e database URL.',
    );
  }
  if (needsStorage) {
    for (const key of [
      'TEST_STORAGE_ENDPOINT',
      'TEST_STORAGE_BUCKET',
      'TEST_STORAGE_ACCESS_KEY',
      'TEST_STORAGE_SECRET_KEY',
    ]) {
      if (!hasValue(env[key])) {
        fail(
          `${key} is required for the storage integration suite and must point at dedicated non-production object storage.`,
        );
      }
    }
    assertNonProductionStorageTarget(env);
  }
}

function assertDistinctRedisTargets(env) {
  const runtimeUrl = env['REDIS_URL'];
  const testUrl = env['TEST_REDIS_URL'];
  if (!hasValue(runtimeUrl) || !hasValue(testUrl)) {
    return;
  }
  const runtimeTarget = redisTargetIdentity(runtimeUrl);
  const testTarget = redisTargetIdentity(testUrl);
  if (
    runtimeTarget === undefined ||
    testTarget === undefined ||
    runtimeTarget !== testTarget
  ) {
    return;
  }
  fail(
    'TEST_REDIS_URL must use a different Redis endpoint or database from REDIS_URL.',
  );
}

function redisTargetIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      return undefined;
    }
    const hostname = normalizeRedisHostname(url.hostname);
    const rawDatabase = url.pathname.replace(/^\/+|\/+$/gu, '') || '0';
    const database = /^\d+$/u.test(rawDatabase)
      ? rawDatabase.replace(/^0+(?=\d)/u, '')
      : rawDatabase;
    return `${hostname}:${url.port || '6379'}/${database}`;
  } catch {
    return undefined;
  }
}

function normalizeRedisHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
    ? 'loopback'
    : normalized;
}

function runMigrations(env) {
  process.stdout.write(
    'integration: applying Prisma migrations to TEST_DATABASE_URL via migrate deploy\n',
  );
  const migrateEnv = {
    ...env,
    DATABASE_URL: env['TEST_DATABASE_URL'],
  };
  const result = spawnSync('pnpm', ['prisma:migrate:deploy'], {
    cwd: root,
    env: migrateEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail(
      'prisma migrate deploy failed against TEST_DATABASE_URL. Integration suite aborted.',
    );
  }
}

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function effectiveEnvValue(processValue, fileValue) {
  return hasValue(processValue) ? processValue : fileValue;
}

function assertNonProductionStorageTarget(env) {
  const endpoint = env['TEST_STORAGE_ENDPOINT'];
  if (!hasValue(endpoint)) {
    return;
  }
  let hostname;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    fail(
      'TEST_STORAGE_ENDPOINT must be a valid http(s) URL for dedicated non-production object storage.',
    );
  }
  if (isBlockedProductionMarker(hostname)) {
    fail(
      `TEST_STORAGE_ENDPOINT host '${hostname}' looks production-marked. Storage integration must use dedicated TEST resources only.`,
    );
  }
  const bucket = env['TEST_STORAGE_BUCKET']?.trim().toLowerCase() ?? '';
  if (isBlockedProductionMarker(bucket.replaceAll('_', '-'))) {
    fail(
      'TEST_STORAGE_BUCKET looks production-marked. Storage integration must use a dedicated TEST bucket.',
    );
  }
}

function isBlockedProductionMarker(value) {
  const labels = value.toLowerCase().split('.');
  return labels.some(
    (label) =>
      label === 'prod' ||
      label === 'production' ||
      label.startsWith('prod-') ||
      label.endsWith('-prod') ||
      label.startsWith('production-') ||
      label.endsWith('-production'),
  );
}

function fail(message) {
  process.stderr.write(`integration: ${message}\n`);
  process.exit(1);
}
