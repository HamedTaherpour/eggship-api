import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const INVENTORY_ROOT = join(__dirname);

function collectSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('Inventory module boundary', () => {
  it('does not import Orders', () => {
    const files = collectSources(INVENTORY_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8').includes('modules/orders'),
    );
    expect(offenders).toEqual([]);
  });
});
