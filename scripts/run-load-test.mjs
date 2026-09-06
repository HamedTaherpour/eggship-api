import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scenarios = {
  smoke: { file: 'smoke.js', vus: 2, duration: '20s', required: [] },
  browse: { file: 'browse.js', vus: 10, duration: '60s', required: [] },
  'order-reads': {
    file: 'order-reads.js',
    vus: 10,
    duration: '60s',
    required: ['LOAD_TEST_USER_TOKENS', 'LOAD_TEST_ORDER_IDS'],
  },
  orders: {
    file: 'orders.js',
    vus: 5,
    duration: '30s',
    required: [
      'LOAD_TEST_USER_TOKENS',
      'LOAD_TEST_PRODUCT_IDS',
      'LOAD_TEST_REGION_ID',
    ],
  },
  analytics: {
    file: 'analytics.js',
    vus: 2,
    duration: '30s',
    required: ['LOAD_TEST_ADMIN_TOKEN'],
  },
};

function fail(message) {
  throw new Error(`Load-test safety check failed: ${message}`);
}
function value(name) {
  return process.env[name]?.trim() ?? '';
}
function sanitizeBaseUrl(raw) {
  const url = new URL(raw);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}
function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function validateConfiguration(name) {
  const scenario = scenarios[name];
  if (!scenario) fail(`unknown scenario '${name}'`);
  if (value('LOAD_TESTS_ENABLED') !== 'true')
    fail('LOAD_TESTS_ENABLED=true is required');
  const environment = value('LOAD_TEST_ENV');
  if (!['local', 'staging'].includes(environment))
    fail('LOAD_TEST_ENV must be local or staging');
  const baseUrl = value('LOAD_TEST_BASE_URL');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail('LOAD_TEST_BASE_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    fail('base URL must use HTTP(S)');
  const host = parsed.hostname.toLowerCase();
  const productionWords = /(^|[.-])(prod|production)([.-]|$)/u;
  if (
    productionWords.test(host) ||
    /production|prod-api|liara\.ir/u.test(baseUrl.toLowerCase())
  )
    fail('production-like target rejected');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (environment === 'local' && !loopback)
    fail('local runs require a loopback target');
  if (
    environment === 'staging' &&
    value('LOAD_TEST_RUNNER_APPROVED') !== 'true'
  )
    fail('staging requires LOAD_TEST_RUNNER_APPROVED=true');
  if (value('LOAD_TEST_RESET') || value('LOAD_TEST_RESEED'))
    fail('reset/reseed is not supported by this harness');
  for (const required of scenario.required)
    if (!value(required)) fail(`${required} is required for ${name}`);
  const csv = (name) =>
    value(name)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  if (csv('LOAD_TEST_USER_TOKENS').some((token) => /\s/u.test(token)))
    fail('tokens must be comma-separated opaque values without whitespace');
  if (scenario.vus > 10 || !/^\d+s$/u.test(scenario.duration))
    fail('scenario bounds are invalid');
  return {
    ...scenario,
    name,
    environment,
    baseUrl: sanitizeBaseUrl(baseUrl),
  };
}

export function buildK6Environment(config, source = process.env) {
  return {
    ...source,
    GIT_SHA: source.GIT_SHA?.trim() || gitSha(),
    APP_VERSION:
      source.APP_VERSION?.trim() ||
      JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version,
    LOAD_TEST_BASE_URL: config.baseUrl,
    LOAD_TEST_ENV: config.environment,
    LOAD_TEST_SCENARIO: config.name,
    LOAD_TEST_VUS: String(config.vus),
    LOAD_TEST_DURATION: config.duration,
    LOAD_TEST_ARTIFACT_STAMP: config.artifactStamp,
  };
}

export function buildK6Arguments(config, script) {
  const gitSha = config.GIT_SHA ?? config.gitSha ?? 'unknown';
  const appVersion = config.APP_VERSION ?? config.appVersion ?? 'unknown';
  return [
    'run',
    '--vus',
    String(config.vus),
    '--duration',
    config.duration,
    '--include-system-env-vars',
    '-e',
    `LOAD_TEST_BASE_URL=${config.baseUrl}`,
    '-e',
    `LOAD_TEST_ENV=${config.environment}`,
    '-e',
    `LOAD_TEST_SCENARIO=${config.name}`,
    '-e',
    `LOAD_TEST_VUS=${config.vus}`,
    '-e',
    `LOAD_TEST_DURATION=${config.duration}`,
    '-e',
    `LOAD_TEST_ARTIFACT_STAMP=${config.artifactStamp}`,
    '-e',
    `GIT_SHA=${gitSha}`,
    '-e',
    `APP_VERSION=${appVersion}`,
    script,
  ];
}

export function main(args = process.argv.slice(2)) {
  const validateOnly = args.includes('--validate-only');
  const staticOnly = args.includes('--static-only');
  const name = args.find((arg) => !arg.startsWith('--'));
  if (staticOnly) {
    for (const scenario of [
      { file: 'common.js' },
      ...Object.values(scenarios),
    ]) {
      execFileSync(
        process.execPath,
        ['--check', resolve('tests/performance/rel-03', scenario.file)],
        { stdio: 'inherit' },
      );
    }
    console.log('REL-03 k6 scenario syntax is valid.');
  } else if (validateOnly) {
    for (const scenario of Object.keys(scenarios))
      validateConfiguration(scenario);
    console.log('REL-03 load-test configuration is valid for all scenarios.');
  } else {
    const config = validateConfiguration(name);
    const artifactDir = resolve('artifacts/load-tests');
    mkdirSync(artifactDir, { recursive: true });
    const artifactStamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const script = resolve('tests/performance/rel-03', config.file);
    const runtimeConfig = { ...config, artifactStamp };
    const runtimeEnvironment = buildK6Environment(runtimeConfig);
    execFileSync(
      'k6',
      buildK6Arguments(
        {
          ...runtimeConfig,
          ...runtimeEnvironment,
        },
        script,
      ),
      {
        stdio: 'inherit',
        env: runtimeEnvironment,
      },
    );
    const prefix = resolve(artifactDir, `${artifactStamp}-${config.name}`);
    const missing = [`${prefix}.json`, `${prefix}.md`].filter(
      (path) => !existsSync(path),
    );
    if (missing.length)
      fail(
        `successful ${config.name} execution did not produce required artifacts: ${missing.join(', ')}`,
      );
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) main();
