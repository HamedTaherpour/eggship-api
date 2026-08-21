import { validateEnvironment } from './environment.validation';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://example.invalid/eggship',
  APP_VERSION: '0.1.0',
  GIT_SHA: 'local',
  JWT_ACCESS_SECRET: 'unit-test-jwt-access-secret-32chars!!',
  OTP_HASH_SECRET: 'unit-test-otp-hash-secret-32chars!!!!',
};

describe('validateEnvironment', () => {
  it('returns normalized typed configuration for valid input', () => {
    expect(validateEnvironment(validEnvironment)).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: 'postgresql://example.invalid/eggship',
      APP_VERSION: '0.1.0',
      GIT_SHA: 'local',
      JWT_ACCESS_SECRET: 'unit-test-jwt-access-secret-32chars!!',
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
      OTP_PROVIDER: 'development',
      OTP_HASH_SECRET: 'unit-test-otp-hash-secret-32chars!!!!',
      OTP_TTL_SECONDS: 300,
      OTP_MAX_ATTEMPTS: 5,
      OTP_RESEND_COOLDOWN_SECONDS: 60,
      OTP_PHONE_WINDOW_SECONDS: 3_600,
      OTP_PHONE_WINDOW_LIMIT: 5,
      OTP_IP_WINDOW_SECONDS: 3_600,
      OTP_IP_WINDOW_LIMIT: 20,
      OTP_VERIFICATION_GRANT_TTL_SECONDS: 600,
      OTP_DEV_CODE: '111111',
      STORAGE_PROVIDER: 'memory',
      STORAGE_PUBLIC_BASE_URL: 'https://media.local.invalid',
      STORAGE_FORCE_PATH_STYLE: true,
      MEDIA_MAX_FILE_BYTES: 5_242_880,
      MEDIA_MAX_FILES_PER_BATCH: 10,
      MEDIA_MAX_BATCH_BYTES: 26_214_400,
      MEDIA_UPLOAD_CONCURRENCY: 3,
    });
  });

  it('rejects missing required variables', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, DATABASE_URL: '' }),
    ).toThrow('DATABASE_URL is required.');
  });

  it('rejects invalid ports', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, PORT: '70000' }),
    ).toThrow('PORT must be an integer between 1 and 65535.');
  });

  it('rejects non-integer port syntax', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, PORT: '3000.5' }),
    ).toThrow('PORT must be an integer between 1 and 65535.');
  });

  it('rejects unsupported environments', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'staging' }),
    ).toThrow('NODE_ENV must be one of: development, test, production.');
  });

  it('rejects malformed PostgreSQL URLs', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'postgresql://',
      }),
    ).toThrow(
      'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    );
  });

  it('requires release metadata', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, APP_VERSION: '' }),
    ).toThrow('APP_VERSION is required.');
    expect(() =>
      validateEnvironment({ ...validEnvironment, GIT_SHA: '' }),
    ).toThrow('GIT_SHA is required.');
  });

  it('requires APP_VERSION to be valid SemVer', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        APP_VERSION: 'not-a-version',
      }),
    ).toThrow('APP_VERSION must be a valid Semantic Version');
    expect(
      validateEnvironment({
        ...validEnvironment,
        APP_VERSION: '0.3.0-rc.1',
      }).APP_VERSION,
    ).toBe('0.3.0-rc.1');
  });

  it('accepts an optional remote Redis URL', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        REDIS_URL: 'rediss://example.invalid:6380',
      }),
    ).toMatchObject({ REDIS_URL: 'rediss://example.invalid:6380' });
  });

  it('treats an empty Redis URL as disabled', () => {
    expect(
      validateEnvironment({ ...validEnvironment, REDIS_URL: '   ' }),
    ).not.toHaveProperty('REDIS_URL');
  });

  it('rejects malformed or unsupported Redis URLs', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, REDIS_URL: 'http://redis' }),
    ).toThrow('REDIS_URL must use the redis:// or rediss:// protocol.');
    expect(() =>
      validateEnvironment({ ...validEnvironment, REDIS_URL: 'redis://' }),
    ).toThrow('REDIS_URL must use the redis:// or rediss:// protocol.');
  });

  it('parses optional OPENAPI_ENABLED overrides', () => {
    expect(
      validateEnvironment({ ...validEnvironment, OPENAPI_ENABLED: 'true' }),
    ).toMatchObject({ OPENAPI_ENABLED: true });
    expect(
      validateEnvironment({ ...validEnvironment, OPENAPI_ENABLED: 'false' }),
    ).toMatchObject({ OPENAPI_ENABLED: false });
    expect(
      validateEnvironment({ ...validEnvironment, OPENAPI_ENABLED: '   ' }),
    ).not.toHaveProperty('OPENAPI_ENABLED');
  });

  it('rejects invalid OPENAPI_ENABLED values', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, OPENAPI_ENABLED: 'yes' }),
    ).toThrow('OPENAPI_ENABLED must be true or false when provided.');
  });

  it('requires a strong JWT_ACCESS_SECRET', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, JWT_ACCESS_SECRET: '' }),
    ).toThrow('JWT_ACCESS_SECRET is required.');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'short-secret',
      }),
    ).toThrow('JWT_ACCESS_SECRET must be at least 32 characters.');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'secret',
      }),
    ).toThrow('JWT_ACCESS_SECRET must be at least 32 characters.');
  });

  it('parses token TTL overrides in seconds', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_TTL: '600',
        REFRESH_TOKEN_TTL: '86400',
      }),
    ).toMatchObject({
      JWT_ACCESS_TTL_SECONDS: 600,
      REFRESH_TOKEN_TTL_SECONDS: 86_400,
    });
  });

  it('rejects TTL values above configured maxima', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_TTL: '3601',
      }),
    ).toThrow('JWT_ACCESS_TTL must be at most 3600 seconds.');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        REFRESH_TOKEN_TTL: '7776001',
      }),
    ).toThrow('REFRESH_TOKEN_TTL must be at most 7776000 seconds.');
  });

  it('rejects repeated-character JWT secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow('JWT_ACCESS_SECRET is too weak.');
  });

  it('defaults OTP_PROVIDER to development outside production', () => {
    expect(validateEnvironment(validEnvironment).OTP_PROVIDER).toBe(
      'development',
    );
  });

  it('forbids development OTP provider in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        OTP_PROVIDER: 'development',
        KAVENEGAR_API_KEY: 'fake-key',
        KAVENEGAR_OTP_TEMPLATE: 'otp-template',
      }),
    ).toThrow(
      'OTP_PROVIDER=development is forbidden when NODE_ENV=production.',
    );
  });

  it('requires Kavenegar credentials when OTP_PROVIDER=kavenegar', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OTP_PROVIDER: 'kavenegar',
      }),
    ).toThrow('KAVENEGAR_API_KEY is required.');
    expect(
      validateEnvironment({
        ...validEnvironment,
        OTP_PROVIDER: 'kavenegar',
        KAVENEGAR_API_KEY: 'fake-api-key',
        KAVENEGAR_OTP_TEMPLATE: 'eggship-otp',
      }),
    ).toMatchObject({
      OTP_PROVIDER: 'kavenegar',
      KAVENEGAR_API_KEY: 'fake-api-key',
      KAVENEGAR_OTP_TEMPLATE: 'eggship-otp',
    });
  });

  it('rejects weak OTP_HASH_SECRET values', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OTP_HASH_SECRET: 'short',
      }),
    ).toThrow('OTP_HASH_SECRET must be at least 32 characters.');
  });

  it('rejects OTP_TTL_SECONDS above the configured maximum', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OTP_TTL_SECONDS: '901',
      }),
    ).toThrow('OTP_TTL_SECONDS must be at most 900 seconds.');
  });

  it('rejects OTP_HASH_SECRET equal to JWT_ACCESS_SECRET', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OTP_HASH_SECRET: validEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow('OTP_HASH_SECRET must be distinct from JWT_ACCESS_SECRET.');
  });

  it('defaults STORAGE_PROVIDER to memory outside production', () => {
    expect(validateEnvironment(validEnvironment).STORAGE_PROVIDER).toBe(
      'memory',
    );
  });

  it('forbids STORAGE_PROVIDER=memory in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        OTP_PROVIDER: 'kavenegar',
        KAVENEGAR_API_KEY: 'fake-api-key',
        KAVENEGAR_OTP_TEMPLATE: 'eggship-otp',
        STORAGE_PROVIDER: 'memory',
      }),
    ).toThrow('STORAGE_PROVIDER=memory is forbidden when NODE_ENV=production.');
  });

  it('requires S3 settings when STORAGE_PROVIDER=s3', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        STORAGE_PROVIDER: 's3',
      }),
    ).toThrow('STORAGE_ENDPOINT is required.');

    expect(
      validateEnvironment({
        ...validEnvironment,
        STORAGE_PROVIDER: 's3',
        STORAGE_ENDPOINT: 'https://storage.example.invalid',
        STORAGE_REGION: 'us-east-1',
        STORAGE_BUCKET: 'eggship-media-dev',
        STORAGE_ACCESS_KEY: 'test-access-key',
        STORAGE_SECRET_KEY: 'test-secret-key',
        STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.invalid',
      }),
    ).toMatchObject({
      STORAGE_PROVIDER: 's3',
      STORAGE_BUCKET: 'eggship-media-dev',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.invalid',
      STORAGE_FORCE_PATH_STYLE: true,
    });
  });

  it('rejects STORAGE_PUBLIC_BASE_URL values that embed credentials', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        STORAGE_PUBLIC_BASE_URL: 'https://user:pass@cdn.example.invalid',
      }),
    ).toThrow(
      'STORAGE_PUBLIC_BASE_URL must be an http(s) URL with a hostname and no credentials.',
    );
  });

  it('rejects STORAGE_ENDPOINT values that embed credentials', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        STORAGE_PROVIDER: 's3',
        STORAGE_ENDPOINT: 'https://user:pass@storage.example.invalid',
        STORAGE_REGION: 'us-east-1',
        STORAGE_BUCKET: 'eggship-media-dev',
        STORAGE_ACCESS_KEY: 'test-access-key',
        STORAGE_SECRET_KEY: 'test-secret-key',
        STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.invalid',
      }),
    ).toThrow(
      'STORAGE_ENDPOINT must be an http(s) URL with a hostname and no credentials.',
    );
  });

  it('rejects MEDIA_MAX_FILE_BYTES above the hard maximum', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        MEDIA_MAX_FILE_BYTES: '999999999',
      }),
    ).toThrow('MEDIA_MAX_FILE_BYTES must be between 1 and 20971520.');
  });
});
