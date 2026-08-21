import type { EnvironmentVariables } from '../../config/environment.validation';

export function resolveOpenApiEnabled(
  nodeEnv: EnvironmentVariables['NODE_ENV'],
  openApiEnabled: boolean | undefined,
): boolean {
  if (openApiEnabled !== undefined) {
    return openApiEnabled;
  }

  return nodeEnv === 'development';
}
