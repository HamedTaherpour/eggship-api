import { normalizeProductName } from './product-name';
import { ProductInvalidNameError } from './product-errors';

describe('normalizeProductName', () => {
  it('trims and accepts a valid name', () => {
    expect(normalizeProductName('  Cage-free eggs  ')).toBe('Cage-free eggs');
  });

  it('rejects empty or whitespace-only names', () => {
    expect(() => normalizeProductName('   ')).toThrow(ProductInvalidNameError);
  });

  it('rejects names longer than 100 characters', () => {
    expect(() => normalizeProductName('x'.repeat(101))).toThrow(
      ProductInvalidNameError,
    );
  });
});
