import {
  assertMediaUploadLimits,
  DEFAULT_MEDIA_MAX_BATCH_BYTES,
  DEFAULT_MEDIA_MAX_FILE_BYTES,
  DEFAULT_MEDIA_MAX_FILES_PER_BATCH,
  DEFAULT_MEDIA_UPLOAD_CONCURRENCY,
} from '../modules/media/domain/media-upload-limits';
import { isSafePublicBaseUrl } from '../modules/media/domain/public-media-url';

const NODE_ENV_VALUES = ['development', 'test', 'production'] as const;

/** Practical SemVer aligned with scripts/lib/release.mjs and instructions/releases.md. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TRIVIAL_ACCESS_SECRETS = new Set([
  'secret',
  'password',
  '123456',
  'changeme',
  'jwt_secret',
  'access_secret',
]);

/** Default short-lived access token lifetime (15 minutes). Configurable via JWT_ACCESS_TTL. */
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = 900;

/** Default refresh-session lifetime (30 days). Configurable via REFRESH_TOKEN_TTL. */
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

/** Default OTP challenge TTL (5 minutes). Initial AUTH-05 starting point. */
export const DEFAULT_OTP_TTL_SECONDS = 300;

/** Default max wrong verification attempts per challenge. */
export const DEFAULT_OTP_MAX_ATTEMPTS = 5;

/** Default resend cooldown after a successful OTP request. */
export const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Default phone request window (1 hour) and limit. */
export const DEFAULT_OTP_PHONE_WINDOW_SECONDS = 3_600;
export const DEFAULT_OTP_PHONE_WINDOW_LIMIT = 5;

/** Default IP request window (1 hour) and limit. */
export const DEFAULT_OTP_IP_WINDOW_SECONDS = 3_600;
export const DEFAULT_OTP_IP_WINDOW_LIMIT = 20;

/** Default verification-grant TTL after successful OTP verify (10 minutes). */
export const DEFAULT_OTP_VERIFICATION_GRANT_TTL_SECONDS = 600;

/** Conservative per-process PostgreSQL pool defaults. */
export const DEFAULT_DATABASE_POOL_MAX = 10;
export const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_DATABASE_IDLE_TIMEOUT_MS = 30_000;

const MIN_JWT_ACCESS_SECRET_LENGTH = 32;
const MIN_OTP_HASH_SECRET_LENGTH = 32;
const MIN_CSRF_SECRET_LENGTH = 32;
const MAX_JWT_ACCESS_TTL_SECONDS = 3_600;
const MAX_REFRESH_TOKEN_TTL_SECONDS = 7_776_000;
const MAX_OTP_TTL_SECONDS = 900;
const MAX_OTP_MAX_ATTEMPTS = 20;
const MAX_OTP_RESEND_COOLDOWN_SECONDS = 600;
const MAX_OTP_WINDOW_SECONDS = 86_400;
const MAX_OTP_WINDOW_LIMIT = 100;
const MAX_OTP_VERIFICATION_GRANT_TTL_SECONDS = 900;
const MAX_DATABASE_POOL_MAX = 50;
const MIN_DATABASE_CONNECTION_TIMEOUT_MS = 250;
const MAX_DATABASE_CONNECTION_TIMEOUT_MS = 30_000;
const MIN_DATABASE_IDLE_TIMEOUT_MS = 1_000;
const MAX_DATABASE_IDLE_TIMEOUT_MS = 300_000;

const OTP_PROVIDER_VALUES = ['development', 'kavenegar'] as const;
const STORAGE_PROVIDER_VALUES = ['memory', 's3'] as const;
const DEFAULT_MEMORY_PUBLIC_BASE_URL = 'https://media.local.invalid';

type NodeEnvironment = (typeof NODE_ENV_VALUES)[number];
export type OtpProviderName = (typeof OTP_PROVIDER_VALUES)[number];
export type StorageProviderName = (typeof STORAGE_PROVIDER_VALUES)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_CONNECTION_TIMEOUT_MS: number;
  DATABASE_IDLE_TIMEOUT_MS: number;
  APP_VERSION: string;
  GIT_SHA: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_SECONDS: number;
  OTP_PROVIDER: OtpProviderName;
  OTP_HASH_SECRET: string;
  CSRF_SECRET: string;
  CSRF_ALLOWED_ORIGINS: string[];
  OTP_TTL_SECONDS: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_RESEND_COOLDOWN_SECONDS: number;
  OTP_PHONE_WINDOW_SECONDS: number;
  OTP_PHONE_WINDOW_LIMIT: number;
  OTP_IP_WINDOW_SECONDS: number;
  OTP_IP_WINDOW_LIMIT: number;
  OTP_VERIFICATION_GRANT_TTL_SECONDS: number;
  OTP_DEV_CODE?: string;
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_OTP_TEMPLATE?: string;
  REDIS_URL?: string;
  OPENAPI_ENABLED?: boolean;
  STORAGE_PROVIDER: StorageProviderName;
  STORAGE_PUBLIC_BASE_URL: string;
  STORAGE_FORCE_PATH_STYLE: boolean;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION?: string;
  STORAGE_BUCKET?: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  MEDIA_MAX_FILE_BYTES: number;
  MEDIA_MAX_FILES_PER_BATCH: number;
  MEDIA_MAX_BATCH_BYTES: number;
  MEDIA_UPLOAD_CONCURRENCY: number;
}

export function validateEnvironment(
  values: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnv = requiredString(values, 'NODE_ENV');
  if (!isNodeEnvironment(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${NODE_ENV_VALUES.join(', ')}.`);
  }

  const portText = requiredString(values, 'PORT');
  if (!/^\d+$/.test(portText)) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const databaseUrl = requiredString(values, 'DATABASE_URL');
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error(
      'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    );
  }

  const databasePoolMax = parseIntegerInRange(
    values,
    'DATABASE_POOL_MAX',
    DEFAULT_DATABASE_POOL_MAX,
    1,
    MAX_DATABASE_POOL_MAX,
  );
  const databaseConnectionTimeoutMs = parseIntegerInRange(
    values,
    'DATABASE_CONNECTION_TIMEOUT_MS',
    DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
    MIN_DATABASE_CONNECTION_TIMEOUT_MS,
    MAX_DATABASE_CONNECTION_TIMEOUT_MS,
  );
  const databaseIdleTimeoutMs = parseIntegerInRange(
    values,
    'DATABASE_IDLE_TIMEOUT_MS',
    DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
    MIN_DATABASE_IDLE_TIMEOUT_MS,
    MAX_DATABASE_IDLE_TIMEOUT_MS,
  );

  const redisUrl = optionalString(values, 'REDIS_URL');
  if (redisUrl !== undefined && !isRedisUrl(redisUrl)) {
    throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
  }

  const openApiEnabled = optionalBoolean(values, 'OPENAPI_ENABLED');
  const appVersion = requiredString(values, 'APP_VERSION');
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(
      'APP_VERSION must be a valid Semantic Version (for example 0.1.0 or 0.2.0-rc.1).',
    );
  }

  const accessSecret = requiredString(values, 'JWT_ACCESS_SECRET');
  assertAccessSecretStrength(accessSecret);

  const accessTtl = parsePositiveIntSeconds(
    values,
    'JWT_ACCESS_TTL',
    DEFAULT_JWT_ACCESS_TTL_SECONDS,
  );
  if (accessTtl > MAX_JWT_ACCESS_TTL_SECONDS) {
    throw new Error(
      `JWT_ACCESS_TTL must be at most ${MAX_JWT_ACCESS_TTL_SECONDS} seconds.`,
    );
  }

  const refreshTtl = parsePositiveIntSeconds(
    values,
    'REFRESH_TOKEN_TTL',
    DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  );
  if (refreshTtl > MAX_REFRESH_TOKEN_TTL_SECONDS) {
    throw new Error(
      `REFRESH_TOKEN_TTL must be at most ${MAX_REFRESH_TOKEN_TTL_SECONDS} seconds.`,
    );
  }

  const otpProvider = resolveOtpProvider(values, nodeEnv);
  const otpHashSecret = requiredString(values, 'OTP_HASH_SECRET');
  assertOtpHashSecretStrength(otpHashSecret);

  if (otpHashSecret === accessSecret) {
    throw new Error('OTP_HASH_SECRET must be distinct from JWT_ACCESS_SECRET.');
  }

  const csrfSecret = requiredString(values, 'CSRF_SECRET');
  assertDedicatedSecretStrength(csrfSecret, 'CSRF_SECRET');
  if (csrfSecret === accessSecret || csrfSecret === otpHashSecret) {
    throw new Error(
      'CSRF_SECRET must be distinct from other application secrets.',
    );
  }
  const csrfAllowedOrigins = parseAllowedOrigins(values, nodeEnv);

  const otpTtl = parsePositiveIntSeconds(
    values,
    'OTP_TTL_SECONDS',
    DEFAULT_OTP_TTL_SECONDS,
  );
  if (otpTtl > MAX_OTP_TTL_SECONDS) {
    throw new Error(
      `OTP_TTL_SECONDS must be at most ${MAX_OTP_TTL_SECONDS} seconds.`,
    );
  }

  const otpMaxAttempts = parsePositiveIntSeconds(
    values,
    'OTP_MAX_ATTEMPTS',
    DEFAULT_OTP_MAX_ATTEMPTS,
  );
  if (otpMaxAttempts > MAX_OTP_MAX_ATTEMPTS) {
    throw new Error(
      `OTP_MAX_ATTEMPTS must be at most ${MAX_OTP_MAX_ATTEMPTS}.`,
    );
  }

  const otpCooldown = parsePositiveIntSeconds(
    values,
    'OTP_RESEND_COOLDOWN_SECONDS',
    DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
  );
  if (otpCooldown > MAX_OTP_RESEND_COOLDOWN_SECONDS) {
    throw new Error(
      `OTP_RESEND_COOLDOWN_SECONDS must be at most ${MAX_OTP_RESEND_COOLDOWN_SECONDS} seconds.`,
    );
  }

  const phoneWindowSeconds = parsePositiveIntSeconds(
    values,
    'OTP_PHONE_WINDOW_SECONDS',
    DEFAULT_OTP_PHONE_WINDOW_SECONDS,
  );
  const phoneWindowLimit = parsePositiveIntSeconds(
    values,
    'OTP_PHONE_WINDOW_LIMIT',
    DEFAULT_OTP_PHONE_WINDOW_LIMIT,
  );
  const ipWindowSeconds = parsePositiveIntSeconds(
    values,
    'OTP_IP_WINDOW_SECONDS',
    DEFAULT_OTP_IP_WINDOW_SECONDS,
  );
  const ipWindowLimit = parsePositiveIntSeconds(
    values,
    'OTP_IP_WINDOW_LIMIT',
    DEFAULT_OTP_IP_WINDOW_LIMIT,
  );
  assertWindowBounds('OTP_PHONE_WINDOW_SECONDS', phoneWindowSeconds);
  assertWindowBounds('OTP_PHONE_WINDOW_LIMIT', phoneWindowLimit, true);
  assertWindowBounds('OTP_IP_WINDOW_SECONDS', ipWindowSeconds);
  assertWindowBounds('OTP_IP_WINDOW_LIMIT', ipWindowLimit, true);

  const verificationGrantTtl = parsePositiveIntSeconds(
    values,
    'OTP_VERIFICATION_GRANT_TTL_SECONDS',
    DEFAULT_OTP_VERIFICATION_GRANT_TTL_SECONDS,
  );
  if (verificationGrantTtl > MAX_OTP_VERIFICATION_GRANT_TTL_SECONDS) {
    throw new Error(
      `OTP_VERIFICATION_GRANT_TTL_SECONDS must be at most ${MAX_OTP_VERIFICATION_GRANT_TTL_SECONDS} seconds.`,
    );
  }

  const otpDevCode =
    otpProvider === 'development'
      ? assertConfiguredOtpDevCode(values)
      : undefined;

  const kavenegar =
    otpProvider === 'kavenegar' ? requireKavenegarConfig(values) : undefined;

  const storage = resolveStorageConfig(values, nodeEnv);
  const mediaLimits = assertMediaUploadLimits({
    maxFileBytes: parsePositiveIntSeconds(
      values,
      'MEDIA_MAX_FILE_BYTES',
      DEFAULT_MEDIA_MAX_FILE_BYTES,
    ),
    maxFilesPerBatch: parsePositiveIntSeconds(
      values,
      'MEDIA_MAX_FILES_PER_BATCH',
      DEFAULT_MEDIA_MAX_FILES_PER_BATCH,
    ),
    maxBatchBytes: parsePositiveIntSeconds(
      values,
      'MEDIA_MAX_BATCH_BYTES',
      DEFAULT_MEDIA_MAX_BATCH_BYTES,
    ),
    uploadConcurrency: parsePositiveIntSeconds(
      values,
      'MEDIA_UPLOAD_CONCURRENCY',
      DEFAULT_MEDIA_UPLOAD_CONCURRENCY,
    ),
  });

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: databasePoolMax,
    DATABASE_CONNECTION_TIMEOUT_MS: databaseConnectionTimeoutMs,
    DATABASE_IDLE_TIMEOUT_MS: databaseIdleTimeoutMs,
    APP_VERSION: appVersion,
    GIT_SHA: requiredString(values, 'GIT_SHA'),
    JWT_ACCESS_SECRET: accessSecret,
    JWT_ACCESS_TTL_SECONDS: accessTtl,
    REFRESH_TOKEN_TTL_SECONDS: refreshTtl,
    OTP_PROVIDER: otpProvider,
    OTP_HASH_SECRET: otpHashSecret,
    CSRF_SECRET: csrfSecret,
    CSRF_ALLOWED_ORIGINS: csrfAllowedOrigins,
    OTP_TTL_SECONDS: otpTtl,
    OTP_MAX_ATTEMPTS: otpMaxAttempts,
    OTP_RESEND_COOLDOWN_SECONDS: otpCooldown,
    OTP_PHONE_WINDOW_SECONDS: phoneWindowSeconds,
    OTP_PHONE_WINDOW_LIMIT: phoneWindowLimit,
    OTP_IP_WINDOW_SECONDS: ipWindowSeconds,
    OTP_IP_WINDOW_LIMIT: ipWindowLimit,
    OTP_VERIFICATION_GRANT_TTL_SECONDS: verificationGrantTtl,
    ...(otpDevCode === undefined ? {} : { OTP_DEV_CODE: otpDevCode }),
    ...(kavenegar === undefined
      ? {}
      : {
          KAVENEGAR_API_KEY: kavenegar.apiKey,
          KAVENEGAR_OTP_TEMPLATE: kavenegar.template,
        }),
    ...(redisUrl === undefined ? {} : { REDIS_URL: redisUrl }),
    ...(openApiEnabled === undefined
      ? {}
      : { OPENAPI_ENABLED: openApiEnabled }),
    STORAGE_PROVIDER: storage.provider,
    STORAGE_PUBLIC_BASE_URL: storage.publicBaseUrl,
    STORAGE_FORCE_PATH_STYLE: storage.forcePathStyle,
    ...(storage.s3 === undefined
      ? {}
      : {
          STORAGE_ENDPOINT: storage.s3.endpoint,
          STORAGE_REGION: storage.s3.region,
          STORAGE_BUCKET: storage.s3.bucket,
          STORAGE_ACCESS_KEY: storage.s3.accessKey,
          STORAGE_SECRET_KEY: storage.s3.secretKey,
        }),
    MEDIA_MAX_FILE_BYTES: mediaLimits.maxFileBytes,
    MEDIA_MAX_FILES_PER_BATCH: mediaLimits.maxFilesPerBatch,
    MEDIA_MAX_BATCH_BYTES: mediaLimits.maxBatchBytes,
    MEDIA_UPLOAD_CONCURRENCY: mediaLimits.uploadConcurrency,
  };
}

function resolveOtpProvider(
  values: Record<string, unknown>,
  nodeEnv: NodeEnvironment,
): OtpProviderName {
  const raw = optionalString(values, 'OTP_PROVIDER');
  const provider: OtpProviderName =
    raw === undefined
      ? nodeEnv === 'production'
        ? 'kavenegar'
        : 'development'
      : parseOtpProvider(raw);

  if (nodeEnv === 'production' && provider === 'development') {
    throw new Error(
      'OTP_PROVIDER=development is forbidden when NODE_ENV=production.',
    );
  }

  return provider;
}

function parseOtpProvider(value: string): OtpProviderName {
  if ((OTP_PROVIDER_VALUES as readonly string[]).includes(value)) {
    return value as OtpProviderName;
  }
  throw new Error(
    `OTP_PROVIDER must be one of: ${OTP_PROVIDER_VALUES.join(', ')}.`,
  );
}

function assertConfiguredOtpDevCode(values: Record<string, unknown>): string {
  const raw = optionalString(values, 'OTP_DEV_CODE') ?? '111111';
  if (!/^\d{6}$/u.test(raw)) {
    throw new Error('OTP_DEV_CODE must be exactly six numeric digits.');
  }
  return raw;
}

function requireKavenegarConfig(values: Record<string, unknown>): {
  apiKey: string;
  template: string;
} {
  const apiKey = requiredString(values, 'KAVENEGAR_API_KEY');
  const template = requiredString(values, 'KAVENEGAR_OTP_TEMPLATE');
  return { apiKey, template };
}

function resolveStorageConfig(
  values: Record<string, unknown>,
  nodeEnv: NodeEnvironment,
): {
  provider: StorageProviderName;
  publicBaseUrl: string;
  forcePathStyle: boolean;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
} {
  const raw = optionalString(values, 'STORAGE_PROVIDER');
  const provider: StorageProviderName =
    raw === undefined
      ? nodeEnv === 'production'
        ? 's3'
        : 'memory'
      : parseStorageProvider(raw);

  if (nodeEnv === 'production' && provider === 'memory') {
    throw new Error(
      'STORAGE_PROVIDER=memory is forbidden when NODE_ENV=production.',
    );
  }

  const forcePathStyle =
    optionalBoolean(values, 'STORAGE_FORCE_PATH_STYLE') ?? true;

  if (provider === 'memory') {
    const publicBaseUrl =
      optionalString(values, 'STORAGE_PUBLIC_BASE_URL') ??
      DEFAULT_MEMORY_PUBLIC_BASE_URL;
    assertPublicBaseUrl(publicBaseUrl);
    return { provider, publicBaseUrl, forcePathStyle };
  }

  const endpoint = requiredString(values, 'STORAGE_ENDPOINT');
  if (!isSafePublicBaseUrl(endpoint)) {
    throw new Error(
      'STORAGE_ENDPOINT must be an http(s) URL with a hostname and no credentials.',
    );
  }
  if (nodeEnv === 'production' && !endpoint.startsWith('https://')) {
    throw new Error(
      'STORAGE_ENDPOINT must use HTTPS when NODE_ENV=production.',
    );
  }
  const region = requiredString(values, 'STORAGE_REGION');
  const bucket = requiredString(values, 'STORAGE_BUCKET');
  const accessKey = requiredString(values, 'STORAGE_ACCESS_KEY');
  const secretKey = requiredString(values, 'STORAGE_SECRET_KEY');
  const publicBaseUrl = requiredString(values, 'STORAGE_PUBLIC_BASE_URL');
  assertPublicBaseUrl(publicBaseUrl);

  return {
    provider,
    publicBaseUrl,
    forcePathStyle,
    s3: { endpoint, region, bucket, accessKey, secretKey },
  };
}

function parseStorageProvider(value: string): StorageProviderName {
  if ((STORAGE_PROVIDER_VALUES as readonly string[]).includes(value)) {
    return value as StorageProviderName;
  }
  throw new Error(
    `STORAGE_PROVIDER must be one of: ${STORAGE_PROVIDER_VALUES.join(', ')}.`,
  );
}

function assertPublicBaseUrl(value: string): void {
  if (!isSafePublicBaseUrl(value)) {
    throw new Error(
      'STORAGE_PUBLIC_BASE_URL must be an http(s) URL with a hostname and no credentials.',
    );
  }
}

function assertWindowBounds(
  envName: string,
  value: number,
  isLimit = false,
): void {
  const max = isLimit ? MAX_OTP_WINDOW_LIMIT : MAX_OTP_WINDOW_SECONDS;
  if (value > max) {
    throw new Error(`${envName} must be at most ${max}.`);
  }
}

function assertAccessSecretStrength(secret: string): void {
  if (secret.length < MIN_JWT_ACCESS_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET must be at least ${MIN_JWT_ACCESS_SECRET_LENGTH} characters.`,
    );
  }
  if (TRIVIAL_ACCESS_SECRETS.has(secret.toLowerCase())) {
    throw new Error('JWT_ACCESS_SECRET is too weak.');
  }
  if (/^(.)\1+$/u.test(secret)) {
    throw new Error('JWT_ACCESS_SECRET is too weak.');
  }
}

function assertOtpHashSecretStrength(secret: string): void {
  if (secret.length < MIN_OTP_HASH_SECRET_LENGTH) {
    throw new Error(
      `OTP_HASH_SECRET must be at least ${MIN_OTP_HASH_SECRET_LENGTH} characters.`,
    );
  }
  if (TRIVIAL_ACCESS_SECRETS.has(secret.toLowerCase())) {
    throw new Error('OTP_HASH_SECRET is too weak.');
  }
  if (/^(.)\1+$/u.test(secret)) {
    throw new Error('OTP_HASH_SECRET is too weak.');
  }
}

function assertDedicatedSecretStrength(secret: string, name: string): void {
  if (secret.length < MIN_CSRF_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_CSRF_SECRET_LENGTH} characters.`,
    );
  }
  if (
    TRIVIAL_ACCESS_SECRETS.has(secret.toLowerCase()) ||
    /^(.)\1+$/u.test(secret)
  ) {
    throw new Error(`${name} is too weak.`);
  }
}

function parseAllowedOrigins(
  values: Record<string, unknown>,
  nodeEnv: NodeEnvironment,
): string[] {
  const raw = optionalString(values, 'CSRF_ALLOWED_ORIGINS');
  if (raw === undefined) {
    if (nodeEnv === 'production') {
      throw new Error('CSRF_ALLOWED_ORIGINS is required in production.');
    }
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('CSRF_ALLOWED_ORIGINS must contain at least one origin.');
  }
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CSRF_ALLOWED_ORIGINS must contain valid origins.');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error(
        'CSRF_ALLOWED_ORIGINS must contain canonical http(s) origins.',
      );
    }
  }
  return [...new Set(origins)];
}

function parsePositiveIntSeconds(
  values: Record<string, unknown>,
  envName: string,
  defaultSeconds: number,
): number {
  const raw = values[envName];
  if (raw === undefined || raw === null || raw === '') {
    return defaultSeconds;
  }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1) {
      throw new Error(`${envName} must be a positive integer.`);
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new Error(`${envName} must be a positive integer.`);
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return defaultSeconds;
  }
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  return parsed;
}

function parseIntegerInRange(
  values: Record<string, unknown>,
  envName: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = parsePositiveIntSeconds(values, envName, defaultValue);
  if (value < minimum || value > maximum) {
    throw new Error(
      `${envName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function requiredString(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function isNodeEnvironment(value: string): value is NodeEnvironment {
  return NODE_ENV_VALUES.some((candidate) => candidate === value);
}

function optionalString(
  values: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = values[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a non-empty string when provided.`);
  }
  const normalizedValue = value.trim();
  return normalizedValue === '' ? undefined : normalizedValue;
}

function optionalBoolean(
  values: Record<string, unknown>,
  name: 'OPENAPI_ENABLED' | 'STORAGE_FORCE_PATH_STYLE',
): boolean | undefined {
  const value = values[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be true or false when provided.`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return undefined;
  }
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`${name} must be true or false when provided.`);
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      url.hostname !== ''
    );
  } catch {
    return false;
  }
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'redis:' || url.protocol === 'rediss:') &&
      url.hostname !== ''
    );
  } catch {
    return false;
  }
}
