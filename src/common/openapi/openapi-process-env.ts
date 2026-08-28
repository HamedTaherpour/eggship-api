/**
 * Side-effect module: import this before AppModule for OpenAPI CLI/tests.
 * ConfigModule.forRoot validates environment when AppModule is evaluated.
 * Assignments overwrite ambient process env so a local `.env` cannot leak
 * Redis or database targets into OpenAPI generation.
 */
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3000';
process.env['DATABASE_URL'] =
  'postgresql://openapi.invalid:5432/eggship_openapi';
process.env['APP_VERSION'] = '0.1.0';
process.env['GIT_SHA'] = 'openapi-generate';
process.env['JWT_ACCESS_SECRET'] = 'openapi-jwt-access-secret-at-least-32ch';
process.env['JWT_ACCESS_TTL'] = '900';
process.env['REFRESH_TOKEN_TTL'] = '2592000';
process.env['OTP_PROVIDER'] = 'development';
process.env['OTP_HASH_SECRET'] = 'openapi-otp-hash-secret-at-least-32ch!';
process.env['CSRF_SECRET'] = 'openapi-csrf-secret-at-least-32-characters!!';
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
