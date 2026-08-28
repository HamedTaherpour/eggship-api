/**
 * Ordinary unit and e2e suites must not use a developer-local `.env`.
 * Values here are synthetic and intentionally non-routable (.invalid).
 * Real-infrastructure suites use tests/integration/setup/setup-integration.ts
 * with explicit TEST_* variables and INTEGRATION_TESTS_ENABLED=true.
 */
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['DATABASE_URL'] = 'postgresql://example.invalid/eggship_test';
process.env['APP_VERSION'] = '0.1.0-test';
process.env['GIT_SHA'] = 'test';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-access-secret-at-least-32-chars';
process.env['JWT_ACCESS_TTL'] = '900';
process.env['REFRESH_TOKEN_TTL'] = '2592000';
process.env['OTP_PROVIDER'] = 'development';
process.env['OTP_HASH_SECRET'] = 'test-otp-hash-secret-at-least-32-chars!';
process.env['CSRF_SECRET'] = 'test-csrf-secret-at-least-32-chars!!';
process.env['CSRF_ALLOWED_ORIGINS'] =
  'http://localhost:3000,http://127.0.0.1:3000';
process.env['OTP_DEV_CODE'] = '111111';
process.env['OTP_TTL_SECONDS'] = '300';
process.env['OTP_MAX_ATTEMPTS'] = '5';
process.env['OTP_RESEND_COOLDOWN_SECONDS'] = '60';
process.env['OTP_PHONE_WINDOW_SECONDS'] = '3600';
process.env['OTP_PHONE_WINDOW_LIMIT'] = '5';
process.env['OTP_IP_WINDOW_SECONDS'] = '3600';
process.env['OTP_IP_WINDOW_LIMIT'] = '20';
process.env['OTP_VERIFICATION_GRANT_TTL_SECONDS'] = '600';
delete process.env['REDIS_URL'];
delete process.env['OPENAPI_ENABLED'];
delete process.env['KAVENEGAR_API_KEY'];
delete process.env['KAVENEGAR_OTP_TEMPLATE'];
delete process.env['INTEGRATION_TESTS_ENABLED'];
delete process.env['TEST_DATABASE_URL'];
delete process.env['TEST_REDIS_URL'];
delete process.env['INTEGRATION_ALLOW_DESTRUCTIVE'];
