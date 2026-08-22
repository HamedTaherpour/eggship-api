import { DiscountInvalidWindowError } from './discount-errors';

/** Validate optional UTC activation window bounds. */
export function normalizeDiscountWindow(payload: {
  startsAt?: Date | null;
  endsAt?: Date | null;
}): { startsAt: Date | null; endsAt: Date | null } {
  const startsAt = payload.startsAt ?? null;
  const endsAt = payload.endsAt ?? null;

  if (startsAt !== null && !(startsAt instanceof Date)) {
    throw new DiscountInvalidWindowError(
      'startsAt must be a Date when provided.',
    );
  }
  if (endsAt !== null && !(endsAt instanceof Date)) {
    throw new DiscountInvalidWindowError(
      'endsAt must be a Date when provided.',
    );
  }
  if (
    startsAt !== null &&
    endsAt !== null &&
    startsAt.getTime() >= endsAt.getTime()
  ) {
    throw new DiscountInvalidWindowError(
      'startsAt must be strictly before endsAt when both are set.',
    );
  }

  return { startsAt, endsAt };
}
