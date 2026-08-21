#!/usr/bin/env node
'use strict';

/**
 * Extract CHANGELOG.md notes for a GitHub Release body.
 * Usage: node scripts/extract-release-notes.mjs <version> [changelogPath]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { extractReleaseNotes } from './lib/release.mjs';

const version = process.argv[2];
const changelogPath = process.argv[3] ?? 'CHANGELOG.md';
const outputPath = process.argv[4];

if (!version) {
  process.stderr.write(
    'Usage: node scripts/extract-release-notes.mjs <version> [CHANGELOG.md] [output.md]\n',
  );
  process.exitCode = 1;
  process.exit();
}

const notes = extractReleaseNotes(readFileSync(changelogPath, 'utf8'), version);
if (!notes.ok) {
  process.stderr.write(`extract-release-notes failed: ${notes.error}\n`);
  process.exitCode = 1;
  process.exit();
}

if (outputPath) {
  writeFileSync(outputPath, notes.body, 'utf8');
} else {
  process.stdout.write(notes.body);
}
