import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/tests/integration/**/*.spec.ts',
  ],
  testPathIgnorePatterns: ['\\.integration-spec\\.ts$'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/test/setup-environment.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/generated/**',
    '!src/common/openapi/generate-openapi.ts',
    '!src/common/openapi/check-openapi.ts',
  ],
  coverageDirectory: 'coverage',
};

export default config;
