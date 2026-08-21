import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ALL_ADMIN_ROLES } from './admin-role';

const SRC_ROOT = join(__dirname, '..', '..');

/**
 * Paths allowed to mention a role name. `common/authz` owns role policy, and
 * generated Prisma code mirrors the database enum.
 */
const POLICY_PATHS = [join('common', 'authz') + sep, join('generated') + sep];

function collectApplicationSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectApplicationSources(path));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      continue;
    }
    const relativePath = relative(SRC_ROOT, path);
    if (POLICY_PATHS.some((prefix) => relativePath.startsWith(prefix))) {
      continue;
    }
    files.push(path);
  }
  return files;
}

/**
 * Removes comments so that prose naming a role — documentation is expected to
 * name them — is not mistaken for code branching on one. Comment markers inside
 * string literals are not tracked, which can only weaken the check on a line
 * that mixes such a literal with a role name, never produce a false alarm.
 */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/\/\/.*$/gmu, '');
}

describe('admin role branching', () => {
  it('never uses a role name outside the authorization policy module', () => {
    // ADR 0007 rejects the legacy pattern of scattered role comparisons. A role
    // literal in executable code anywhere else is the first step back toward it,
    // and it is cheap to catch here: application code checks permissions, and
    // Admin persistence carries the role as an opaque `AdminRole` value.
    const offenders: string[] = [];

    for (const file of collectApplicationSources(SRC_ROOT)) {
      const contents = stripComments(readFileSync(file, 'utf8'));
      for (const role of ALL_ADMIN_ROLES) {
        if (contents.includes(role)) {
          offenders.push(`${relative(SRC_ROOT, file)}: ${role}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('detects a role literal in executable code', () => {
    // Guards the guard: the comment stripping must not blind the scan.
    const sample = 'if (admin.role === "SUPER_ADMIN") { return true; }';

    expect(
      ALL_ADMIN_ROLES.filter((role) => stripComments(sample).includes(role)),
    ).toEqual(['SUPER_ADMIN']);
  });

  it('scans a non-empty source set, so the guard cannot pass vacuously', () => {
    expect(collectApplicationSources(SRC_ROOT).length).toBeGreaterThan(20);
  });
});
