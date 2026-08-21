#!/usr/bin/env node
'use strict';

/**
 * Prepare package.json + CHANGELOG.md for a human-controlled release.
 * Does not create tags, push, publish GitHub Releases, or deploy.
 *
 * Usage:
 *   pnpm release:prepare <version>
 *   pnpm release:prepare <version> --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isValidSemver,
  parseChangelog,
  parsePackageVersion,
  prepareChangelogText,
  todayUtcDate,
  updatePackageJsonVersion,
} from './lib/release.mjs';

const root = process.cwd();

function usage() {
  process.stderr.write(
    'Usage: pnpm release:prepare <version> [--dry-run]\n' +
      'Example: pnpm release:prepare 0.2.0\n' +
      '         pnpm release:prepare 0.2.0 --dry-run\n',
  );
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => arg !== '--dry-run');

if (positional.length !== 1) {
  usage();
  process.exitCode = 1;
  process.exit();
}

const nextVersion = positional[0].trim();
if (!isValidSemver(nextVersion)) {
  process.stderr.write(
    `release:prepare failed: "${nextVersion}" is not valid SemVer.\n`,
  );
  process.exitCode = 1;
  process.exit();
}

const packageText = read('package.json');
const packageResult = parsePackageVersion(packageText);
if (!packageResult.ok) {
  process.stderr.write(`release:prepare failed: ${packageResult.error}\n`);
  process.exitCode = 1;
  process.exit();
}

if (packageResult.version === nextVersion) {
  process.stderr.write(
    `release:prepare failed: target version ${nextVersion} is already the package.json version.\n`,
  );
  process.exitCode = 1;
  process.exit();
}

const changelogText = read('CHANGELOG.md');
const changelogParsed = parseChangelog(changelogText);
if (!changelogParsed.ok) {
  process.stderr.write(`release:prepare failed: ${changelogParsed.error}\n`);
  process.exitCode = 1;
  process.exit();
}

const releaseDate = todayUtcDate();
const nextChangelog = prepareChangelogText(
  changelogText,
  nextVersion,
  releaseDate,
);
if (!nextChangelog.ok) {
  process.stderr.write(`release:prepare failed: ${nextChangelog.error}\n`);
  process.exitCode = 1;
  process.exit();
}

const nextPackageText = updatePackageJsonVersion(packageText, nextVersion);

if (dryRun) {
  process.stdout.write(
    `release:prepare dry-run: would set package.json version ${packageResult.version} → ${nextVersion}\n`,
  );
  process.stdout.write(
    `release:prepare dry-run: would move [Unreleased] → [${nextVersion}] - ${releaseDate}\n`,
  );
  process.stdout.write(
    'release:prepare dry-run: no files were modified; no tag/push/release was created.\n',
  );
  process.exit(0);
}

writeFileSync(join(root, 'package.json'), nextPackageText, 'utf8');
writeFileSync(join(root, 'CHANGELOG.md'), nextChangelog.text, 'utf8');

process.stdout.write(
  `release:prepare: updated package.json to ${nextVersion} and CHANGELOG.md [${nextVersion}] - ${releaseDate}\n`,
);
process.stdout.write(
  'Next human steps: review diff → commit → annotated tag v' +
    nextVersion +
    ' → push → GitHub Release workflow.\n',
);
process.stdout.write(
  'This command did not create a tag, push, publish a release, or deploy.\n',
);
