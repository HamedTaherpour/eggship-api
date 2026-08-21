import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Inventory ledger repository surface', () => {
  it('does not expose update or delete APIs', () => {
    const source = readFileSync(
      join(__dirname, 'inventory-ledger.repository.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /inventoryLedger\.(update|delete|updateMany|deleteMany)\(/u,
    );
    expect(source).toContain('Append-only');
  });
});
