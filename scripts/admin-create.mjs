#!/usr/bin/env node
'use strict';

/**
 * Operator wrapper for Admin provisioning.
 * Collects email/role/password (hidden stdin when possible), shows a masked
 * database target, then runs the Nest CLI entry with explicit env vars.
 * Never prints the password. Never reads generic app secrets as the password.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { stdin as stdinStream, stderr } from 'node:process';

const root = process.cwd();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--password' || token.startsWith('--password=')) {
      throw new Error(
        'Do not pass --password. Use a hidden prompt or EGGSHIP_ADMIN_CREATE_PASSWORD.',
      );
    }
    if (token === '--email' || token === '--role' || token === '--confirm') {
      out[token.slice(2)] = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      out.help = true;
      continue;
    }
    if (typeof token === 'string' && token.startsWith('--')) {
      throw new Error(`Unknown flag: ${token}`);
    }
  }
  return out;
}

function loadDotEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/u)) {
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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function maskDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//u, '');
  const port = url.port === '' ? '' : `:${url.port}`;
  const db = database === '' ? '' : `/${database}`;
  return `${url.protocol.replace(/:$/u, '')}://${url.hostname}${port}${db}`;
}

function printHelp() {
  stderr.write(`Create an Admin identity (never runs automatically).

Usage:
  pnpm admin:create -- --email ops@example.test --role SUPER_ADMIN

Password:
  Hidden prompt on a TTY, or EGGSHIP_ADMIN_CREATE_PASSWORD for automation.
  Do not pass the password as a CLI flag (avoids shell history).

Confirmation:
  Development/test: EGGSHIP_ADMIN_CREATE_CONFIRM=yes
  Production: EGGSHIP_ADMIN_CREATE_CONFIRM=I_UNDERSTAND_PRODUCTION:<db-host>

Role is required and has no default. Privileged bootstrap must name SUPER_ADMIN
explicitly. Duplicate emails are refused. The password is never printed afterwards.
`);
}

async function promptHidden(label) {
  if (!stdinStream.isTTY) {
    throw new Error(
      'Password prompt requires a TTY. Set EGGSHIP_ADMIN_CREATE_PASSWORD for non-interactive use.',
    );
  }
  stderr.write(label);
  stdinStream.setRawMode(true);
  stdinStream.resume();
  stdinStream.setEncoding('utf8');
  let value = '';
  await new Promise((resolve, reject) => {
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdinStream.setRawMode(false);
        stdinStream.pause();
        stdinStream.off('data', onData);
        stderr.write('\n');
        resolve(undefined);
        return;
      }
      if (char === '\u0003') {
        reject(new Error('Interrupted.'));
        return;
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdinStream.on('data', onData);
  });
  return value;
}

async function promptLine(label) {
  const rl = createInterface({ input: stdinStream, output: stderr });
  const answer = await new Promise((resolve) => {
    rl.question(label, (value) => {
      rl.close();
      resolve(value);
    });
  });
  return String(answer).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  loadDotEnv();

  const email = args.email ?? process.env.EGGSHIP_ADMIN_CREATE_EMAIL ?? '';
  const role = args.role ?? process.env.EGGSHIP_ADMIN_CREATE_ROLE ?? '';
  if (email === '' || role === '') {
    printHelp();
    throw new Error('Both --email and --role are required.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required so the target database is explicit.',
    );
  }

  stderr.write(`Database target: ${maskDatabaseUrl(databaseUrl)}\n`);
  stderr.write(
    'This command never prints the password and never creates a default account.\n',
  );

  let confirm = args.confirm ?? process.env.EGGSHIP_ADMIN_CREATE_CONFIRM;
  if (confirm === undefined || confirm === '') {
    confirm = await promptLine(
      'Type yes to continue (or the production token): ',
    );
  }

  let password = process.env.EGGSHIP_ADMIN_CREATE_PASSWORD;
  if (password === undefined || password === '') {
    password = await promptHidden('Password (hidden): ');
  }

  const env = {
    ...process.env,
    EGGSHIP_ADMIN_CREATE_EMAIL: email,
    EGGSHIP_ADMIN_CREATE_PASSWORD: password,
    EGGSHIP_ADMIN_CREATE_ROLE: role,
    EGGSHIP_ADMIN_CREATE_CONFIRM: confirm,
  };

  const entry = join(root, 'dist', 'cli', 'create-admin.js');
  const compiled = existsSync(entry);
  const command = compiled
    ? ['node', entry]
    : ['pnpm', 'exec', 'nest', 'start', '--entryFile', 'cli/create-admin'];

  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

void main().catch((error) => {
  const raw = error instanceof Error ? error.message : 'Admin create failed.';
  stderr.write(
    `${raw.replace(/(postgres(?:ql)?:\/\/)[^@\s/]+@/giu, '$1[REDACTED]@')}\n`,
  );
  process.exit(1);
});
