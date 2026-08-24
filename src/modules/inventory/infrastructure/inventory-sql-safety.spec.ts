import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Inventory raw SQL safety', () => {
  it('uses tagged Prisma.sql and never interpolates identifiers unsafely', () => {
    const balance = readFileSync(
      join(__dirname, 'inventory-balance.repository.ts'),
      'utf8',
    );
    const reservations = readFileSync(
      join(__dirname, 'inventory-reservation.repository.ts'),
      'utf8',
    );
    for (const source of [balance, reservations]) {
      expect(source).toContain('Prisma.sql');
      expect(source).not.toContain('$queryRawUnsafe');
      expect(source).not.toContain('$executeRawUnsafe');
      expect(source).not.toContain('ORDER BY ${');
      expect(source).not.toMatch(
        /(?:FROM|JOIN|UPDATE|INTO|TABLE|ORDER BY|GROUP BY)\s+\$\{/u,
      );
    }
  });
});
