import type { ConfigModuleOptions } from '@nestjs/config';
import { validateWorkerEnvironment } from './worker-environment.validation';
import { shouldIgnoreEnvFile } from './config-module.options';

export function createWorkerConfigModuleOptions(): ConfigModuleOptions {
  return {
    cache: true,
    isGlobal: true,
    ignoreEnvFile: shouldIgnoreEnvFile(),
    validate: validateWorkerEnvironment,
    load: [
      (): Record<string, number> => ({
        WORKER_CONCURRENCY: Number(process.env['WORKER_CONCURRENCY'] ?? 5),
        WORKER_SHUTDOWN_TIMEOUT_MS: Number(
          process.env['WORKER_SHUTDOWN_TIMEOUT_MS'] ?? 30_000,
        ),
      }),
    ],
  };
}
