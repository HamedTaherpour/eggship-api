import type { ConfigModuleOptions } from '@nestjs/config';
import { validateEnvironment } from './environment.validation';

/**
 * Nest ConfigModule loads `.env` into `process.env` by default.
 * Ordinary unit and e2e suites must not pick up a developer's local
 * `REDIS_URL` / `DATABASE_URL` after test setup clears those keys.
 */
export function shouldIgnoreEnvFile(
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): boolean {
  return nodeEnv === 'test';
}

export function createConfigModuleOptions(): ConfigModuleOptions {
  return {
    cache: true,
    isGlobal: true,
    ignoreEnvFile: shouldIgnoreEnvFile(),
    validate: validateEnvironment,
  };
}
