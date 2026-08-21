import {
  createConfigModuleOptions,
  shouldIgnoreEnvFile,
} from './config-module.options';
import { validateEnvironment } from './environment.validation';

describe('createConfigModuleOptions', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  it('ignores .env files when NODE_ENV is test', () => {
    expect(shouldIgnoreEnvFile('test')).toBe(true);
    process.env['NODE_ENV'] = 'test';
    expect(createConfigModuleOptions()).toMatchObject({
      cache: true,
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    });
  });

  it('loads .env for development and production runtimes', () => {
    expect(shouldIgnoreEnvFile('development')).toBe(false);
    expect(shouldIgnoreEnvFile('production')).toBe(false);

    process.env['NODE_ENV'] = 'development';
    expect(createConfigModuleOptions().ignoreEnvFile).toBe(false);

    process.env['NODE_ENV'] = 'production';
    expect(createConfigModuleOptions().ignoreEnvFile).toBe(false);

    delete process.env['NODE_ENV'];
    expect(shouldIgnoreEnvFile()).toBe(false);
    expect(createConfigModuleOptions().ignoreEnvFile).toBe(false);
  });
});
