import { RegionInvalidNameError } from './region-errors';

/** Maximum stored length for Region.name (matches Prisma VarChar(100)). */
export const REGION_NAME_MAX_LENGTH = 100;

/**
 * Canonicalize a region display name for persistence.
 * Trim only — do not invent case-folding or Unicode normalization beyond trim.
 */
export function normalizeRegionName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new RegionInvalidNameError('Region name must be a string.');
  }

  const name = raw.trim();
  if (name.length < 1 || name.length > REGION_NAME_MAX_LENGTH) {
    throw new RegionInvalidNameError(
      `Region name must be between 1 and ${REGION_NAME_MAX_LENGTH} characters after trimming.`,
    );
  }

  return name;
}
