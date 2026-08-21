import type { Config } from 'jest';

const suite = process.env['INTEGRATION_SUITE'] ?? 'all';

const testMatch =
  suite === 'postgres'
    ? ['<rootDir>/tests/integration/postgres/**/*.integration-spec.ts']
    : suite === 'redis'
      ? ['<rootDir>/tests/integration/redis/**/*.integration-spec.ts']
      : suite === 'storage'
        ? ['<rootDir>/tests/integration/storage/**/*.integration-spec.ts']
        : [
            '<rootDir>/tests/integration/postgres/**/*.integration-spec.ts',
            '<rootDir>/tests/integration/redis/**/*.integration-spec.ts',
            '<rootDir>/tests/integration/domain/**/*.integration-spec.ts',
          ];

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch,
  passWithNoTests: false,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/tests/integration/setup/setup-integration.ts'],
};

export default config;
