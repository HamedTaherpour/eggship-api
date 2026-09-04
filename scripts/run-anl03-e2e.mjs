#!/usr/bin/env node
'use strict';

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const values = parseEnv(readFileSync('.env', 'utf8'));
const env = { ...process.env };
for (const key of [
  'INTEGRATION_TESTS_ENABLED',
  'INTEGRATION_ALLOW_DESTRUCTIVE',
  'TEST_DATABASE_URL',
]) {
  if (!env[key] && values[key]) env[key] = values[key];
}
if (env.INTEGRATION_TESTS_ENABLED !== 'true' || !env.TEST_DATABASE_URL) {
  fail(
    'ANL-03 E2E requires INTEGRATION_TESTS_ENABLED=true and dedicated TEST_DATABASE_URL.',
  );
}
const runtime = env.DATABASE_URL ?? values.DATABASE_URL;
if (runtime && target(runtime) === target(env.TEST_DATABASE_URL)) {
  fail(
    'TEST_DATABASE_URL must use a different PostgreSQL endpoint or database from DATABASE_URL.',
  );
}
env.INTEGRATION_SUITE = 'postgres';
const result = spawnSync(
  'pnpm',
  ['exec', 'jest', '--config', 'test/jest-anl03-e2e.config.ts', '--runInBand'],
  { env, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (match) result[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  return result;
}
function target(value) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
