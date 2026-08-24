import {
  applyIntegrationEnvironment,
  mergeIntegrationKeysIntoProcessEnv,
  readIntegrationKeysFromEnvFile,
  resolveIntegrationEnvironment,
  type IntegrationSuite,
} from '../support/integration-environment';

const suite = parseSuite(process.env['INTEGRATION_SUITE']);

mergeIntegrationKeysIntoProcessEnv(
  readIntegrationKeysFromEnvFile(process.cwd(), process.env, suite),
);
const resolved = resolveIntegrationEnvironment({ suite });
applyIntegrationEnvironment(resolved);

function parseSuite(value: string | undefined): IntegrationSuite {
  if (value === undefined || value === '' || value === 'all') {
    return 'all';
  }
  if (value === 'postgres' || value === 'redis' || value === 'storage') {
    return value;
  }
  throw new Error(
    `INTEGRATION_SUITE must be all, postgres, redis, or storage (received '${value}').`,
  );
}
