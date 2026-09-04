import {
  applyIntegrationEnvironment,
  mergeIntegrationKeysIntoProcessEnv,
  readIntegrationKeysFromEnvFile,
  resolveIntegrationEnvironment,
} from '../tests/integration/support/integration-environment';

const suite = 'postgres' as const;

mergeIntegrationKeysIntoProcessEnv(
  readIntegrationKeysFromEnvFile(process.cwd(), process.env, suite),
);
applyIntegrationEnvironment(
  resolveIntegrationEnvironment({ suite, env: process.env }),
);
