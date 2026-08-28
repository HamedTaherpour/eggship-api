#!/usr/bin/env node
'use strict';

/**
 * Lightweight developer environment checks for EggShip API.
 * Does not contact remote PostgreSQL or Redis, mutate databases,
 * print secrets, or require Docker.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

function readText(path) {
  return readFileSync(path, 'utf8');
}

function parseEngines(packageJson) {
  return {
    node: packageJson.engines?.node ?? '>=24.0.0 <25',
    pnpm: packageJson.engines?.pnpm ?? '>=10.0.0',
  };
}

function parseMajorMinorPatch(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function satisfiesNodeRange(version, range) {
  const parsed = parseMajorMinorPatch(version);
  if (!parsed) {
    return false;
  }
  // Repository engines are currently ">=24.0.0 <25".
  if (range.includes('>=24') && range.includes('<25')) {
    return parsed.major === 24;
  }
  return parsed.major >= 24;
}

function satisfiesPnpmRange(version, range) {
  const parsed = parseMajorMinorPatch(version);
  if (!parsed) {
    return false;
  }
  if (range.includes('>=10')) {
    return parsed.major >= 10;
  }
  return parsed.major >= 10;
}

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function safeTargetMetadata(urlText, kind) {
  try {
    const url = new URL(urlText);
    const expected =
      kind === 'postgres'
        ? url.protocol === 'postgresql:' || url.protocol === 'postgres:'
        : url.protocol === 'redis:' || url.protocol === 'rediss:';
    if (!expected || url.hostname === '') {
      return { ok: false };
    }
    return {
      ok: true,
      protocol: url.protocol.replace(/:$/u, ''),
      host: url.hostname,
      port: url.port === '' ? undefined : url.port,
      path: url.pathname === '/' ? undefined : url.pathname,
    };
  } catch {
    return { ok: false };
  }
}

function isGitIgnored(relativePath) {
  try {
    execFileSync('git', ['check-ignore', '-q', relativePath], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 1
    ) {
      return false;
    }
    return null;
  }
}

function isGitTracked(relativePath) {
  try {
    const output = execFileSync('git', ['ls-files', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return output !== '';
  } catch {
    return null;
  }
}

const packageJsonPath = join(root, 'package.json');
if (!existsSync(packageJsonPath)) {
  errors.push('package.json is missing.');
  finish();
}

const packageJson = JSON.parse(readText(packageJsonPath));
const engines = parseEngines(packageJson);

if (!satisfiesNodeRange(process.version, engines.node)) {
  errors.push(
    `Node.js ${process.version} does not satisfy engines.node (${engines.node}).`,
  );
} else {
  process.stdout.write(`node: ${process.version} ok\n`);
}

let pnpmVersion = null;
const pnpmCandidates =
  process.platform === 'win32' ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm'];

for (const candidate of pnpmCandidates) {
  try {
    pnpmVersion = execFileSync(candidate, ['--version'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    break;
  } catch {
    // try next candidate
  }
}

if (pnpmVersion === null) {
  try {
    pnpmVersion = execFileSync('corepack', ['pnpm', '--version'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    errors.push('pnpm is not available on PATH.');
  }
}

if (pnpmVersion !== null) {
  if (!satisfiesPnpmRange(pnpmVersion, engines.pnpm)) {
    errors.push(
      `pnpm ${pnpmVersion} does not satisfy engines.pnpm (${engines.pnpm}).`,
    );
  } else {
    process.stdout.write(`pnpm: ${pnpmVersion} ok\n`);
  }
}

const examplePath = join(root, '.env.example');
if (!existsSync(examplePath)) {
  errors.push('.env.example is missing.');
} else {
  process.stdout.write('.env.example: present\n');
}

const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  warnings.push(
    '.env is missing. Copy .env.example to .env and fill required values.',
  );
  warnings.push('Windows PowerShell: Copy-Item .env.example .env');
  warnings.push('POSIX: cp .env.example .env');
} else {
  const ignoreState = isGitIgnored('.env');
  if (ignoreState === false) {
    errors.push('.env exists but is not ignored by Git.');
  } else if (ignoreState === true) {
    process.stdout.write('.env: present and gitignored\n');
  } else {
    process.stdout.write('.env: present (git ignore state unavailable)\n');
  }

  const tracked = isGitTracked('.env');
  if (tracked === true) {
    errors.push('.env is tracked by Git; remove it from version control.');
  }

  const values = parseEnvFile(readText(envPath));
  const required = [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'APP_VERSION',
    'GIT_SHA',
    'JWT_ACCESS_SECRET',
    'OTP_HASH_SECRET',
    'CSRF_SECRET',
    'CSRF_ALLOWED_ORIGINS',
  ];
  for (const key of required) {
    const value = values[key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} is missing or empty in .env.`);
    }
  }

  const nodeEnv = values['NODE_ENV']?.trim();
  if (
    nodeEnv !== undefined &&
    nodeEnv !== '' &&
    !['development', 'test', 'production'].includes(nodeEnv)
  ) {
    errors.push(
      'NODE_ENV must be one of: development, test, production (staging is a deployment tier, not a NODE_ENV value).',
    );
  }

  if (nodeEnv === 'production') {
    warnings.push(
      'This local .env sets NODE_ENV=production. Local development should normally use NODE_ENV=development with dedicated non-production PostgreSQL/Redis.',
    );
  }

  const databaseUrl = values['DATABASE_URL']?.trim();
  if (typeof databaseUrl === 'string' && databaseUrl !== '') {
    const meta = safeTargetMetadata(databaseUrl, 'postgres');
    if (!meta.ok) {
      errors.push(
        'DATABASE_URL must use postgresql:// or postgres:// with a hostname.',
      );
    } else {
      process.stdout.write(
        `database: protocol=${meta.protocol} host=${meta.host}${meta.port ? ` port=${meta.port}` : ''}${meta.path ? ` path=${meta.path}` : ''}\n`,
      );
    }
  }

  const redisUrl = values['REDIS_URL']?.trim();
  if (redisUrl === undefined || redisUrl === '') {
    process.stdout.write(
      'redis: not configured (API may start without Redis)\n',
    );
  } else {
    const meta = safeTargetMetadata(redisUrl, 'redis');
    if (!meta.ok) {
      errors.push('REDIS_URL must use redis:// or rediss:// with a hostname.');
    } else {
      process.stdout.write(
        `redis: configured protocol=${meta.protocol} host=${meta.host}${meta.port ? ` port=${meta.port}` : ''}\n`,
      );
      warnings.push(
        'REDIS_URL is set. Use only dedicated development Redis; never production Redis.',
      );
    }
  }

  const openApi = values['OPENAPI_ENABLED']?.trim().toLowerCase();
  if (
    openApi !== undefined &&
    openApi !== '' &&
    openApi !== 'true' &&
    openApi !== 'false'
  ) {
    errors.push('OPENAPI_ENABLED must be true or false when provided.');
  }
}

for (const suspicious of ['.env.local', '.env.production', '.env.staging']) {
  if (existsSync(join(root, suspicious)) && isGitTracked(suspicious) === true) {
    errors.push(
      `${suspicious} is tracked by Git; secrets must not be committed.`,
    );
  }
}

if (existsSync(join(root, 'docker-compose.yml'))) {
  process.stdout.write(
    'docker: compose file present (optional only; not required for local development)\n',
  );
}

finish();

function finish() {
  for (const warning of warnings) {
    process.stdout.write(`warning: ${warning}\n`);
  }
  if (errors.length > 0) {
    process.stderr.write('env:check failed:\n');
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('env:check: ok\n');
  process.exit(0);
}
