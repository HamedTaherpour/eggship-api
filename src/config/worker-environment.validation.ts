import { validateEnvironmentBase } from './worker-environment.validation.helpers';

export interface WorkerEnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_VERSION: string;
  GIT_SHA: string;
  REDIS_URL: string;
  WORKER_CONCURRENCY: number;
  WORKER_SHUTDOWN_TIMEOUT_MS: number;
}

export function validateWorkerEnvironment(
  values: Record<string, unknown>,
): WorkerEnvironmentVariables {
  return validateEnvironmentBase(values);
}
