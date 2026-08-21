import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN_ROOT = join(__dirname);

function collectDomainSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDomainSources(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('Inventory domain boundary', () => {
  it('does not import Prisma or Redis types', () => {
    const files = collectDomainSources(DOMAIN_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (
        source.includes('generated/prisma') ||
        source.includes('PrismaClient') ||
        source.includes('TransactionClient') ||
        source.includes('ioredis') ||
        source.includes('bullmq')
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
