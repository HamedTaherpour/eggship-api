const NODE_ENVS = ['development', 'test', 'production'] as const;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
import type { WorkerEnvironmentVariables } from './worker-environment.validation';

export function validateEnvironmentBase(
  values: Record<string, unknown>,
): WorkerEnvironmentVariables {
  const nodeEnv = required(values, 'NODE_ENV');
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnv)) {
    throw new Error('NODE_ENV must be one of: development, test, production.');
  }
  const appVersion = required(values, 'APP_VERSION');
  if (!SEMVER.test(appVersion))
    throw new Error('APP_VERSION must be a valid Semantic Version.');
  const gitSha = required(values, 'GIT_SHA');
  const redisUrl = required(values, 'REDIS_URL');
  try {
    const parsed = new URL(redisUrl);
    if (
      !['redis:', 'rediss:'].includes(parsed.protocol) ||
      parsed.hostname === ''
    )
      throw new Error();
  } catch {
    throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
  }
  const databaseUrl = required(values, 'DATABASE_URL');
  try {
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.hostname === ''
    )
      throw new Error();
  } catch {
    throw new Error(
      'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    );
  }
  const fcmProjectId = required(values, 'FCM_PROJECT_ID');
  const fcmClientEmail = required(values, 'FCM_CLIENT_EMAIL');
  const fcmPrivateKey = required(values, 'FCM_PRIVATE_KEY');
  if (
    !fcmPrivateKey.includes('BEGIN PRIVATE KEY') ||
    !fcmPrivateKey.includes('END PRIVATE KEY')
  )
    throw new Error('FCM_PRIVATE_KEY must be a PEM private key.');
  return {
    NODE_ENV: nodeEnv as 'development' | 'test' | 'production',
    APP_VERSION: appVersion,
    GIT_SHA: gitSha,
    REDIS_URL: redisUrl,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: boundedInteger(values, 'DATABASE_POOL_MAX', 10, 1, 50),
    DATABASE_CONNECTION_TIMEOUT_MS: boundedInteger(
      values,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      5_000,
      250,
      30_000,
    ),
    DATABASE_IDLE_TIMEOUT_MS: boundedInteger(
      values,
      'DATABASE_IDLE_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    FCM_PROJECT_ID: fcmProjectId,
    FCM_CLIENT_EMAIL: fcmClientEmail,
    FCM_PRIVATE_KEY: fcmPrivateKey,
    WORKER_CONCURRENCY: boundedInteger(values, 'WORKER_CONCURRENCY', 5, 1, 100),
    WORKER_SHUTDOWN_TIMEOUT_MS: boundedInteger(
      values,
      'WORKER_SHUTDOWN_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
  };
}
function required(values: Record<string, unknown>, name: string): string {
  const value = typeof values[name] === 'string' ? values[name].trim() : '';
  if (value === '') throw new Error(`${name} is required.`);
  return value;
}
function boundedInteger(
  values: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = values[name];
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === ''))
    return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
