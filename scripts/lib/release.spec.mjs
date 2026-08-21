#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertReleaseConsistency,
  extractReleaseNotes,
  isValidSemver,
  parseChangelog,
  parsePackageVersion,
  prepareChangelogText,
  tagForVersion,
  unreleasedHasEntries,
  updatePackageJsonVersion,
  versionFromTag,
} from './release.mjs';

const sampleChangelog = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Something new.

### Fixed

- A bug.

## [0.1.0] - 2026-08-19

### Added

- Initial NestJS backend repository foundation.
`;

describe('isValidSemver', () => {
  it('accepts core and prerelease versions', () => {
    assert.equal(isValidSemver('0.1.0'), true);
    assert.equal(isValidSemver('1.2.3'), true);
    assert.equal(isValidSemver('0.3.0-rc.1'), true);
    assert.equal(isValidSemver('1.0.0+build.5'), true);
  });

  it('rejects invalid versions', () => {
    assert.equal(isValidSemver(''), false);
    assert.equal(isValidSemver('v0.1.0'), false);
    assert.equal(isValidSemver('0.1'), false);
    assert.equal(isValidSemver('01.0.0'), false);
    assert.equal(isValidSemver('not-a-version'), false);
  });
});

describe('tag helpers', () => {
  it('builds and parses annotated tag names', () => {
    assert.equal(tagForVersion('0.2.0'), 'v0.2.0');
    assert.equal(versionFromTag('v0.2.0'), '0.2.0');
    assert.equal(versionFromTag('0.2.0'), null);
    assert.equal(versionFromTag('vbad'), null);
  });
});

describe('parsePackageVersion', () => {
  it('reads a valid package version', () => {
    assert.deepEqual(parsePackageVersion('{"version":"0.1.0"}'), {
      ok: true,
      version: '0.1.0',
    });
  });

  it('rejects invalid package versions', () => {
    assert.equal(parsePackageVersion('{"version":"nope"}').ok, false);
    assert.equal(parsePackageVersion('{').ok, false);
  });
});

describe('parseChangelog', () => {
  it('parses Unreleased and dated releases', () => {
    const parsed = parseChangelog(sampleChangelog);
    assert.equal(parsed.ok, true);
    assert.equal(unreleasedHasEntries(parsed.unreleasedBody), true);
    assert.equal(parsed.releases.length, 1);
    assert.equal(parsed.releases[0].version, '0.1.0');
    assert.equal(parsed.releases[0].date, '2026-08-19');
  });

  it('requires an Unreleased section', () => {
    const result = parseChangelog(`# Changelog

## [0.1.0] - 2026-08-19

### Added

- Initial.
`);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unreleased/);
  });

  it('rejects duplicate release versions', () => {
    const result = parseChangelog(`# Changelog

## [Unreleased]

## [0.1.0] - 2026-08-19

### Added

- One.

## [0.1.0] - 2026-08-20

### Added

- Two.
`);
    assert.equal(result.ok, false);
    assert.match(result.error, /duplicate/i);
  });
});

describe('assertReleaseConsistency', () => {
  it('requires package version to appear in changelog releases', () => {
    const parsed = parseChangelog(sampleChangelog);
    assert.deepEqual(assertReleaseConsistency('0.1.0', parsed), []);
    const mismatch = assertReleaseConsistency('0.2.0', parsed);
    assert.equal(mismatch.length, 1);
    assert.match(mismatch[0], /0\.2\.0/);
  });
});

describe('prepareChangelogText', () => {
  it('moves Unreleased into a dated release and recreates Unreleased', () => {
    const prepared = prepareChangelogText(
      sampleChangelog,
      '0.2.0',
      '2026-08-20',
    );
    assert.equal(prepared.ok, true);
    assert.match(
      prepared.text,
      /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-08-20/,
    );
    assert.match(prepared.text, /Something new/);
    assert.match(prepared.text, /## \[0\.1\.0\] - 2026-08-19/);

    const parsed = parseChangelog(prepared.text);
    assert.equal(parsed.ok, true);
    assert.equal(unreleasedHasEntries(parsed.unreleasedBody), false);
    assert.equal(parsed.releases[0].version, '0.2.0');
  });

  it('refuses duplicate target versions', () => {
    const prepared = prepareChangelogText(
      sampleChangelog,
      '0.1.0',
      '2026-08-20',
    );
    assert.equal(prepared.ok, false);
    assert.match(prepared.error, /already contains/);
  });

  it('refuses empty Unreleased', () => {
    const empty = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-08-19

### Added

- Initial.
`;
    const prepared = prepareChangelogText(empty, '0.2.0', '2026-08-20');
    assert.equal(prepared.ok, false);
    assert.match(prepared.error, /no entries/i);
  });
});

describe('updatePackageJsonVersion', () => {
  it('rewrites the version field', () => {
    const next = updatePackageJsonVersion(
      '{\n  "name": "eggship-api",\n  "version": "0.1.0"\n}\n',
      '0.2.0',
    );
    assert.equal(JSON.parse(next).version, '0.2.0');
  });
});

describe('extractReleaseNotes', () => {
  it('returns the changelog section as release notes', () => {
    const notes = extractReleaseNotes(sampleChangelog, '0.1.0');
    assert.equal(notes.ok, true);
    assert.equal(notes.title, 'EggShip API v0.1.0');
    assert.match(notes.body, /Initial NestJS/);
  });
});

describe('prerelease handling', () => {
  it('allows preparing a prerelease version string', () => {
    const prepared = prepareChangelogText(
      sampleChangelog,
      '0.2.0-rc.1',
      '2026-08-20',
    );
    assert.equal(prepared.ok, true);
    assert.match(prepared.text, /## \[0\.2\.0-rc\.1\] - 2026-08-20/);
  });
});
