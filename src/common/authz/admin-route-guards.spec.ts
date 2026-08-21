import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..');

function collectAdminControllers(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAdminControllers(path));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      continue;
    }
    const source = readFileSync(path, 'utf8');
    if (
      /@Controller\(\s*['`]admin(?:\/|['`])/u.test(source) ||
      /@Controller\(\s*['`]admin['`]/u.test(source)
    ) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Auth-lifecycle Admin routes may omit PermissionGuard: login/refresh/logout
 * are unauthenticated or optional-AT, and /me plus logout-all authenticate
 * without a resource permission. Every other Admin controller must attach
 * AccessTokenGuard and PermissionGuard at class level.
 */
const AUTH_LIFECYCLE_ALLOWLIST = join(
  'modules',
  'auth',
  'api',
  'admin-auth.controller.ts',
);

describe('admin route guards', () => {
  it('allowlists only the Admin auth lifecycle controller without PermissionGuard', () => {
    const controllers = collectAdminControllers(SRC_ROOT);
    expect(controllers.length).toBeGreaterThan(0);

    const relativePaths = controllers.map((file) =>
      relative(SRC_ROOT, file).split('\\').join('/'),
    );
    const expectedAllowlist = AUTH_LIFECYCLE_ALLOWLIST.split('\\').join('/');
    expect(relativePaths).toContain(expectedAllowlist);

    for (const file of controllers) {
      const rel = relative(SRC_ROOT, file).split('\\').join('/');
      const source = readFileSync(file, 'utf8');
      if (rel === expectedAllowlist) {
        expect(source).toContain('AccessTokenGuard');
        expect(source).not.toContain('PermissionGuard');
        continue;
      }
      expect(source).toMatch(/@UseGuards\([^)]*AccessTokenGuard/u);
      expect(source).toMatch(/@UseGuards\([^)]*PermissionGuard/u);
      expect(source).toContain('RequirePermissions');
    }
  });
});
