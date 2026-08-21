#!/usr/bin/env node
'use strict';

/**
 * Shared release validation and changelog helpers.
 * Pure functions only — no Git tag/push/release side effects.
 */

/** Practical SemVer (core + optional prerelease + build metadata). */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const REQUIRED_RELEASE_FILES = [
  'package.json',
  'CHANGELOG.md',
  'instructions/releases.md',
  '.github/workflows/release.yml',
];

export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_PATTERN.test(version.trim());
}

export function normalizeVersion(version) {
  if (typeof version !== 'string') {
    return null;
  }
  const trimmed = version.trim();
  if (trimmed.startsWith('v') || trimmed.startsWith('V')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

export function tagForVersion(version) {
  return `v${version}`;
}

export function versionFromTag(tag) {
  if (typeof tag !== 'string') {
    return null;
  }
  const trimmed = tag.trim();
  if (!trimmed.startsWith('v')) {
    return null;
  }
  const version = trimmed.slice(1);
  return isValidSemver(version) ? version : null;
}

/**
 * @returns {{ ok: true, version: string } | { ok: false, error: string }}
 */
export function parsePackageVersion(packageJsonText) {
  let parsed;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return { ok: false, error: 'package.json is not valid JSON.' };
  }
  if (typeof parsed.version !== 'string' || parsed.version.trim() === '') {
    return { ok: false, error: 'package.json is missing a version string.' };
  }
  const version = parsed.version.trim();
  if (!isValidSemver(version)) {
    return {
      ok: false,
      error: `package.json version "${version}" is not valid SemVer.`,
    };
  }
  return { ok: true, version };
}

/**
 * @returns {{
 *   ok: true,
 *   unreleasedBody: string,
 *   releases: Array<{ version: string, date: string | null, body: string, headerLine: string }>,
 *   preface: string
 * } | { ok: false, error: string }}
 */
export function parseChangelog(changelogText) {
  if (typeof changelogText !== 'string' || changelogText.trim() === '') {
    return { ok: false, error: 'CHANGELOG.md is empty.' };
  }

  const lines = changelogText.split(/\r?\n/u);
  const sectionHeader = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/u;

  const indices = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = sectionHeader.exec(lines[i]);
    if (match) {
      indices.push({
        lineIndex: i,
        label: match[1],
        date: match[2] ?? null,
        headerLine: lines[i],
      });
    }
  }

  if (indices.length === 0) {
    return { ok: false, error: 'CHANGELOG.md has no ## [version] sections.' };
  }

  if (indices[0].label !== 'Unreleased') {
    return {
      ok: false,
      error: 'CHANGELOG.md must start version sections with ## [Unreleased].',
    };
  }

  const unreleasedEnd =
    indices.length > 1 ? indices[1].lineIndex : lines.length;
  const unreleasedBody = lines
    .slice(indices[0].lineIndex + 1, unreleasedEnd)
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '');

  const releases = [];
  const seen = new Set();

  for (let i = 1; i < indices.length; i += 1) {
    const current = indices[i];
    if (current.label === 'Unreleased') {
      return {
        ok: false,
        error: 'CHANGELOG.md contains more than one [Unreleased] section.',
      };
    }
    if (!isValidSemver(current.label)) {
      return {
        ok: false,
        error: `CHANGELOG.md release "${current.label}" is not valid SemVer.`,
      };
    }
    if (seen.has(current.label)) {
      return {
        ok: false,
        error: `CHANGELOG.md contains duplicate release version ${current.label}.`,
      };
    }
    seen.add(current.label);

    if (!current.date) {
      return {
        ok: false,
        error: `CHANGELOG.md release [${current.label}] is missing a YYYY-MM-DD date.`,
      };
    }

    const end =
      i + 1 < indices.length ? indices[i + 1].lineIndex : lines.length;
    const body = lines
      .slice(current.lineIndex + 1, end)
      .join('\n')
      .replace(/^\n+/u, '')
      .replace(/\n+$/u, '');

    releases.push({
      version: current.label,
      date: current.date,
      body,
      headerLine: current.headerLine,
    });
  }

  const preface = lines.slice(0, indices[0].lineIndex).join('\n');

  return {
    ok: true,
    unreleasedBody,
    releases,
    preface: preface.replace(/\n+$/u, ''),
  };
}

export function assertReleaseConsistency(packageVersion, changelog) {
  const errors = [];
  if (!isValidSemver(packageVersion)) {
    errors.push(`package version "${packageVersion}" is not valid SemVer.`);
  }
  if (!changelog.ok) {
    errors.push(changelog.error);
    return errors;
  }

  const releasedVersions = new Set(changelog.releases.map((r) => r.version));
  if (!releasedVersions.has(packageVersion)) {
    errors.push(
      `package.json version ${packageVersion} has no matching ## [${packageVersion}] section in CHANGELOG.md.`,
    );
  }

  return errors;
}

export function todayUtcDate(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function unreleasedHasEntries(unreleasedBody) {
  const withoutHeadings = unreleasedBody
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === '') {
        return false;
      }
      if (/^###\s+/u.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();
  return withoutHeadings.length > 0;
}

/**
 * Build updated changelog text for a release preparation.
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function prepareChangelogText(changelogText, nextVersion, releaseDate) {
  if (!isValidSemver(nextVersion)) {
    return {
      ok: false,
      error: `Version "${nextVersion}" is not valid SemVer.`,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)) {
    return { ok: false, error: `Release date "${releaseDate}" is invalid.` };
  }

  const parsed = parseChangelog(changelogText);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.releases.some((release) => release.version === nextVersion)) {
    return {
      ok: false,
      error: `CHANGELOG.md already contains release [${nextVersion}].`,
    };
  }

  if (!unreleasedHasEntries(parsed.unreleasedBody)) {
    return {
      ok: false,
      error: 'CHANGELOG.md [Unreleased] has no entries to release.',
    };
  }

  const releasedBody = parsed.unreleasedBody.replace(/\n+$/u, '');
  const priorSections = parsed.releases
    .map((release) => `${release.headerLine}\n\n${release.body}`.trimEnd())
    .join('\n\n');

  const parts = [
    parsed.preface.trimEnd(),
    '',
    '## [Unreleased]',
    '',
    `## [${nextVersion}] - ${releaseDate}`,
    '',
    releasedBody,
  ];

  if (priorSections) {
    parts.push('', priorSections);
  }

  parts.push('');

  return { ok: true, text: parts.join('\n') };
}

export function updatePackageJsonVersion(packageJsonText, nextVersion) {
  if (!isValidSemver(nextVersion)) {
    throw new Error(`Version "${nextVersion}" is not valid SemVer.`);
  }
  const parsed = JSON.parse(packageJsonText);
  parsed.version = nextVersion;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function extractReleaseNotes(changelogText, version) {
  const parsed = parseChangelog(changelogText);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const release = parsed.releases.find((entry) => entry.version === version);
  if (!release) {
    return {
      ok: false,
      error: `No CHANGELOG.md section found for ${version}.`,
    };
  }
  const body = release.body.trim();
  if (body === '') {
    return {
      ok: false,
      error: `CHANGELOG.md section [${version}] is empty.`,
    };
  }
  return {
    ok: true,
    title: `EggShip API v${version}`,
    body: `## [${version}] - ${release.date}\n\n${body}\n`,
  };
}
