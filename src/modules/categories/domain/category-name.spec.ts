import {
  CATEGORY_NAME_MAX_LENGTH,
  normalizeCategoryName,
} from './category-name';
import { CategoryInvalidNameError } from './category-errors';

describe('normalizeCategoryName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCategoryName('  Dairy  ')).toBe('Dairy');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => normalizeCategoryName('')).toThrow(CategoryInvalidNameError);
    expect(() => normalizeCategoryName('   ')).toThrow(
      CategoryInvalidNameError,
    );
  });

  it('rejects names longer than the max length', () => {
    expect(() =>
      normalizeCategoryName('a'.repeat(CATEGORY_NAME_MAX_LENGTH + 1)),
    ).toThrow(CategoryInvalidNameError);
  });

  it('accepts a name at the max length', () => {
    const name = 'a'.repeat(CATEGORY_NAME_MAX_LENGTH);
    expect(normalizeCategoryName(name)).toBe(name);
  });
});
