import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  safeConnectionMetadata,
  type SafeConnectionMetadata,
} from './safe-connection-metadata';
import { createTestRunId } from './test-run-id';

export type IntegrationSuite = 'all' | 'postgres' | 'redis' | 'storage';

export interface IntegrationEnvironment {
  suite: IntegrationSuite;
  testRunId: string;
  allowDestructive: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  databaseMetadata?: SafeConnectionMetadata;
  redisMetadata?: SafeConnectionMetadata;
}

export class IntegrationEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationEnvironmentError';
  }
}

const INTEGRATION_ENV_KEYS = [
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
] as const;

const SYNTHETIC_UNIT_DATABASE_URL = 'postgresql://example.invalid/eggship_test';

/**
 * Opt-in keys that may be read from a developer `.env` for integration suites.
 * Never copies DATABASE_URL or REDIS_URL into the integration target.
 */
export function readIntegrationKeysFromEnvFile(
  rootDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  suite: IntegrationSuite = 'all',
): Record<string, string> {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  const values = parseEnvFile(readFileSync(envPath, 'utf8'));
  if (suite === 'all' || suite === 'postgres') {
    assertDistinctDatabaseTargets({
      DATABASE_URL: effectiveEnvValue(
        env['DATABASE_URL'],
        values['DATABASE_URL'],
      ),
      TEST_DATABASE_URL: effectiveEnvValue(
        env['TEST_DATABASE_URL'],
        values['TEST_DATABASE_URL'],
      ),
    });
  }
  if (suite === 'all' || suite === 'redis') {
    assertDistinctRedisTargets({
      REDIS_URL: effectiveEnvValue(env['REDIS_URL'], values['REDIS_URL']),
      TEST_REDIS_URL: effectiveEnvValue(
        env['TEST_REDIS_URL'],
        values['TEST_REDIS_URL'],
      ),
    });
  }
  return pickIntegrationKeys(values);
}

export function pickIntegrationKeys(
  values: Record<string, string>,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of INTEGRATION_ENV_KEYS) {
    const value = values[key];
    if (typeof value === 'string' && value.trim() !== '') {
      selected[key] = value.trim();
    }
  }
  return selected;
}

/**
 * Merges file-sourced integration keys into process.env only when unset.
 * Does not load DATABASE_URL / REDIS_URL for integration targeting.
 */
export function mergeIntegrationKeysIntoProcessEnv(
  keys: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(keys)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }
}

export function resolveIntegrationEnvironment(options: {
  suite: IntegrationSuite;
  env?: NodeJS.ProcessEnv;
  testRunId?: string;
}): IntegrationEnvironment {
  const env = options.env ?? process.env;
  assertIntegrationEnabled(env);

  const allowDestructive = isExactTrue(env['INTEGRATION_ALLOW_DESTRUCTIVE']);
  const needsDatabase = options.suite === 'all' || options.suite === 'postgres';
  const needsRedis = options.suite === 'all' || options.suite === 'redis';
  if (needsDatabase) {
    assertDistinctDatabaseTargets(env);
  }
  if (needsRedis) {
    assertDistinctRedisTargets(env);
  }
  assertNotUsingRuntimeInfrastructureUrls(env, {
    needsDatabase,
    needsRedis,
  });

  const databaseUrl = needsDatabase
    ? requireTestUrl(env, 'TEST_DATABASE_URL', 'postgres')
    : undefined;
  const redisUrl = needsRedis
    ? requireTestUrl(env, 'TEST_REDIS_URL', 'redis')
    : undefined;

  return {
    suite: options.suite,
    testRunId: options.testRunId ?? createTestRunId(),
    allowDestructive,
    ...(databaseUrl === undefined
      ? {}
      : {
          databaseUrl,
          databaseMetadata: safeConnectionMetadata(databaseUrl, 'postgres'),
        }),
    ...(redisUrl === undefined
      ? {}
      : {
          redisUrl,
          redisMetadata: safeConnectionMetadata(redisUrl, 'redis'),
        }),
  };
}

/**
 * Applies resolved integration targets into process.env for Nest/Prisma/Redis.
 * Maps TEST_* → DATABASE_URL / REDIS_URL for the duration of the suite only.
 */
export function applyIntegrationEnvironment(
  resolved: IntegrationEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env['NODE_ENV'] = 'test';
  env['PORT'] = env['PORT'] ?? '3001';
  env['APP_VERSION'] = env['APP_VERSION'] ?? '0.1.0-integration';
  env['GIT_SHA'] = env['GIT_SHA'] ?? 'integration';
  env['JWT_ACCESS_SECRET'] =
    env['JWT_ACCESS_SECRET'] ?? 'integration-jwt-access-secret-32chars-min';
  env['JWT_ACCESS_TTL'] = env['JWT_ACCESS_TTL'] ?? '900';
  env['REFRESH_TOKEN_TTL'] = env['REFRESH_TOKEN_TTL'] ?? '2592000';
  env['OTP_PROVIDER'] = env['OTP_PROVIDER'] ?? 'development';
  env['OTP_HASH_SECRET'] =
    env['OTP_HASH_SECRET'] ?? 'integration-otp-hash-secret-32chars-min';
  env['CSRF_SECRET'] =
    env['CSRF_SECRET'] ?? 'integration-csrf-secret-32chars-min';
  env['CSRF_ALLOWED_ORIGINS'] =
    env['CSRF_ALLOWED_ORIGINS'] ??
    'http://localhost:3000,http://127.0.0.1:3000';
  env['OTP_DEV_CODE'] = env['OTP_DEV_CODE'] ?? '111111';
  env['OTP_TTL_SECONDS'] = env['OTP_TTL_SECONDS'] ?? '300';
  env['OTP_MAX_ATTEMPTS'] = env['OTP_MAX_ATTEMPTS'] ?? '5';
  env['OTP_RESEND_COOLDOWN_SECONDS'] =
    env['OTP_RESEND_COOLDOWN_SECONDS'] ?? '60';
  env['OTP_PHONE_WINDOW_SECONDS'] = env['OTP_PHONE_WINDOW_SECONDS'] ?? '3600';
  env['OTP_PHONE_WINDOW_LIMIT'] = env['OTP_PHONE_WINDOW_LIMIT'] ?? '50';
  env['OTP_IP_WINDOW_SECONDS'] = env['OTP_IP_WINDOW_SECONDS'] ?? '3600';
  env['OTP_IP_WINDOW_LIMIT'] = env['OTP_IP_WINDOW_LIMIT'] ?? '100';
  env['OTP_VERIFICATION_GRANT_TTL_SECONDS'] =
    env['OTP_VERIFICATION_GRANT_TTL_SECONDS'] ?? '600';
  env['EGGSHIP_TEST_RUN_ID'] = resolved.testRunId;
  env['INTEGRATION_TESTS_ENABLED'] = 'true';
  if (resolved.allowDestructive) {
    env['INTEGRATION_ALLOW_DESTRUCTIVE'] = 'true';
  }

  if (resolved.databaseUrl !== undefined) {
    env['TEST_DATABASE_URL'] = resolved.databaseUrl;
    env['DATABASE_URL'] = resolved.databaseUrl;
    // The order-create integration suite deliberately creates a 20-way
    // advisory-lock stampede. Keep that test budget out of production defaults.
    env['DATABASE_POOL_MAX'] = '32';
    env['DATABASE_CONNECTION_TIMEOUT_MS'] = '5000';
    env['DATABASE_IDLE_TIMEOUT_MS'] = '10000';
  } else {
    // Environment validation requires this setting even when a Redis-only
    // testing module never constructs Prisma. Keep runtime DB credentials out
    // of that suite with the established non-routable unit/e2e placeholder.
    env['DATABASE_URL'] = SYNTHETIC_UNIT_DATABASE_URL;
  }
  if (resolved.redisUrl !== undefined) {
    env['TEST_REDIS_URL'] = resolved.redisUrl;
    env['REDIS_URL'] = resolved.redisUrl;
  } else {
    delete env['REDIS_URL'];
  }
}

export function assertDestructiveOperationsAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertIntegrationEnabled(env);
  if (!isExactTrue(env['INTEGRATION_ALLOW_DESTRUCTIVE'])) {
    throw new IntegrationEnvironmentError(
      'Destructive integration operations require INTEGRATION_ALLOW_DESTRUCTIVE=true in addition to INTEGRATION_TESTS_ENABLED=true.',
    );
  }
}

function assertIntegrationEnabled(env: NodeJS.ProcessEnv): void {
  if (!isExactTrue(env['INTEGRATION_TESTS_ENABLED'])) {
    throw new IntegrationEnvironmentError(
      'Integration tests require INTEGRATION_TESTS_ENABLED=true. Ordinary pnpm test / pnpm test:e2e remain infrastructure-free.',
    );
  }
}

function assertNotUsingRuntimeInfrastructureUrls(
  env: NodeJS.ProcessEnv,
  requirements: { needsDatabase: boolean; needsRedis: boolean },
): void {
  if (
    requirements.needsDatabase &&
    hasNonEmpty(env['DATABASE_URL']) &&
    !hasNonEmpty(env['TEST_DATABASE_URL'])
  ) {
    throw new IntegrationEnvironmentError(
      'Refusing to use DATABASE_URL for integration tests. Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL resource.',
    );
  }
  if (
    requirements.needsRedis &&
    hasNonEmpty(env['REDIS_URL']) &&
    !hasNonEmpty(env['TEST_REDIS_URL'])
  ) {
    throw new IntegrationEnvironmentError(
      'Refusing to use REDIS_URL for integration tests. Set TEST_REDIS_URL to a dedicated disposable Redis resource.',
    );
  }
}

export function assertDistinctDatabaseTargets(
  env: NodeJS.ProcessEnv | Record<string, string>,
): void {
  const runtimeUrl = env['DATABASE_URL'];
  const testUrl = env['TEST_DATABASE_URL'];
  if (!hasNonEmpty(runtimeUrl) || !hasNonEmpty(testUrl)) {
    return;
  }
  const runtimeTarget = postgresTargetIdentity(runtimeUrl);
  const testTarget = postgresTargetIdentity(testUrl);
  if (
    runtimeTarget === undefined ||
    testTarget === undefined ||
    runtimeTarget !== testTarget
  ) {
    return;
  }
  throw new IntegrationEnvironmentError(
    'TEST_DATABASE_URL must use a different PostgreSQL endpoint or database from DATABASE_URL.',
  );
}

export function assertDistinctRedisTargets(
  env: NodeJS.ProcessEnv | Record<string, string>,
): void {
  const runtimeUrl = env['REDIS_URL'];
  const testUrl = env['TEST_REDIS_URL'];
  if (!hasNonEmpty(runtimeUrl) || !hasNonEmpty(testUrl)) {
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
  throw new IntegrationEnvironmentError(
    'TEST_REDIS_URL must use a different Redis endpoint or database from REDIS_URL.',
  );
}

function postgresTargetIdentity(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      return undefined;
    }
    const hostname = normalizeLoopbackHostname(url.hostname);
    const rawDatabase = url.pathname.replace(/^\/+|\/+$/gu, '') || 'postgres';
    return `${hostname}:${url.port || '5432'}/${rawDatabase}`;
  } catch {
    return undefined;
  }
}

function redisTargetIdentity(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      return undefined;
    }
    const hostname = normalizeLoopbackHostname(url.hostname);
    const rawDatabase = url.pathname.replace(/^\/+|\/+$/gu, '') || '0';
    const database = /^\d+$/u.test(rawDatabase)
      ? rawDatabase.replace(/^0+(?=\d)/u, '')
      : rawDatabase;
    return `${hostname}:${url.port || '6379'}/${database}`;
  } catch {
    return undefined;
  }
}

function normalizeLoopbackHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
    ? 'loopback'
    : normalized;
}

function requireTestUrl(
  env: NodeJS.ProcessEnv,
  name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL',
  kind: 'postgres' | 'redis',
): string {
  const value = optionalTestUrl(env, name, kind);
  if (value === undefined) {
    throw new IntegrationEnvironmentError(
      `${name} is required for this integration suite and must point at dedicated non-production test infrastructure.`,
    );
  }
  return value;
}

function optionalTestUrl(
  env: NodeJS.ProcessEnv,
  name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL',
  kind: 'postgres' | 'redis',
): string | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = raw.trim();
  const metadata = safeConnectionMetadata(value, kind);
  if (metadata === undefined) {
    throw new IntegrationEnvironmentError(
      `${name} must be a valid ${kind === 'postgres' ? 'postgresql:// or postgres://' : 'redis:// or rediss://'} URL with a hostname.`,
    );
  }
  assertAcceptableIntegrationTarget(name, value, metadata);
  return value;
}

function assertAcceptableIntegrationTarget(
  name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL',
  value: string,
  metadata: SafeConnectionMetadata,
): void {
  if (name === 'TEST_DATABASE_URL' && value === SYNTHETIC_UNIT_DATABASE_URL) {
    throw new IntegrationEnvironmentError(
      'TEST_DATABASE_URL must not reuse the synthetic unit/e2e database URL. Real PostgreSQL must be contacted.',
    );
  }
  if (metadata.host.endsWith('.invalid')) {
    throw new IntegrationEnvironmentError(
      `${name} host '${metadata.host}' is reserved for non-routable documentation/tests and is not real infrastructure.`,
    );
  }
  if (isBlockedProductionMarker(metadata.host)) {
    throw new IntegrationEnvironmentError(
      `${name} host '${metadata.host}' looks production-marked. Integration suites must use dedicated TEST resources only.`,
    );
  }
}

/**
 * Only reject markers that are explicit and reliable—not hostname guessing.
 * Labels such as `prod` or `production` as a DNS label are treated as unsafe.
 */
function isBlockedProductionMarker(hostname: string): boolean {
  const labels = hostname.toLowerCase().split('.');
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

function isExactTrue(value: string | undefined): boolean {
  return value?.trim() === 'true';
}

function hasNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function effectiveEnvValue(
  processValue: string | undefined,
  fileValue: string | undefined,
): string | undefined {
  return hasNonEmpty(processValue) ? processValue : fileValue;
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
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
