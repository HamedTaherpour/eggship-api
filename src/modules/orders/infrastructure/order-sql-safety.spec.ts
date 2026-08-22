import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Order raw SQL safety', () => {
  it('uses tagged Prisma.sql and never interpolates identifiers unsafely', () => {
    const source = readFileSync(join(__dirname, 'order.repository.ts'), 'utf8');
    expect(source).toContain('Prisma.sql');
    expect(source).not.toContain('$queryRawUnsafe');
    expect(source).not.toContain('$executeRawUnsafe');
    expect(source).not.toContain('ORDER BY ${');
    expect(source).not.toMatch(/\$\{[^}]*\}`/u);
    expect(source).not.toMatch(/async updateStatus\b/u);
    expect(source).not.toMatch(/\bupdateStatus\s*\(/u);
    expect(source).toContain('AND "userId" = ${spec.userId}::uuid');
  });
});
