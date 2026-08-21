import { CategoryInvalidNameError } from './category-errors';

/** Maximum stored length for Category.name (matches Prisma VarChar(100)). */
export const CATEGORY_NAME_MAX_LENGTH = 100;

/**
 * Canonicalize a category display name for persistence.
 * Trim only — do not invent case-folding or Unicode normalization beyond trim.
 */
export function normalizeCategoryName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new CategoryInvalidNameError('Category name must be a string.');
  }

  const name = raw.trim();
  if (name.length < 1 || name.length > CATEGORY_NAME_MAX_LENGTH) {
    throw new CategoryInvalidNameError(
      `Category name must be between 1 and ${CATEGORY_NAME_MAX_LENGTH} characters after trimming.`,
    );
  }

  return name;
}
