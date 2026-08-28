import type { ConfigModuleOptions } from '@nestjs/config';
import { validateWorkerEnvironment } from './worker-environment.validation';
import { shouldIgnoreEnvFile } from './config-module.options';

export function createWorkerConfigModuleOptions(): ConfigModuleOptions {
  return {
    cache: true,
    isGlobal: true,
    ignoreEnvFile: shouldIgnoreEnvFile(),
    validate: validateWorkerEnvironment,
  };
}
