#!/usr/bin/env node
'use strict';

/**
 * Validate EggShip release metadata consistency.
 * Does not create tags, push, publish releases, or require Docker/PostgreSQL/Redis.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUIRED_RELEASE_FILES,
  assertReleaseConsistency,
  parseChangelog,
  parsePackageVersion,
  tagForVersion,
} from './lib/release.mjs';

const root = process.cwd();
const errors = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

for (const relativePath of REQUIRED_RELEASE_FILES) {
  if (!existsSync(join(root, relativePath))) {
    errors.push(`Missing required release file: ${relativePath}`);
  }
}

let packageVersion = null;
if (existsSync(join(root, 'package.json'))) {
  const packageResult = parsePackageVersion(read('package.json'));
  if (!packageResult.ok) {
    errors.push(packageResult.error);
  } else {
    packageVersion = packageResult.version;
  }
}

let changelog = { ok: false, error: 'CHANGELOG.md was not read.' };
if (existsSync(join(root, 'CHANGELOG.md'))) {
  changelog = parseChangelog(read('CHANGELOG.md'));
  if (!changelog.ok) {
    errors.push(changelog.error);
  }
}

if (packageVersion !== null) {
  errors.push(...assertReleaseConsistency(packageVersion, changelog));
}

if (errors.length > 0) {
  process.stderr.write('release:check failed:\n');
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `release:check: ok (version ${packageVersion}, tag ${tagForVersion(packageVersion)}, ${changelog.releases.length} changelog release(s))\n`,
  );
}
