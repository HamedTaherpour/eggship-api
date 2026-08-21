/**
 * Canonical Admin login email.
 *
 * Storage form: trimmed and lowercased ASCII, for example `ops.lead@eggship.test`.
 *
 * Normalization is deliberately minimal. Provider-specific folding (Gmail dot
 * removal, plus-tag stripping) is **not** applied: it would silently merge two
 * addresses the operator considers distinct, and it encodes one mail provider's
 * behavior into EggShip identity. `ops+warehouse@example.com` and
 * `ops@example.com` are different admins.
 *
 * Lowercasing the local part technically diverges from RFC 5321, which allows a
 * case-sensitive local part. No mail provider in practice treats it that way,
 * and a case-sensitive login identifier is a support hazard, so the whole
 * address is folded. The database enforces the same canonical form.
 */

/** RFC 5321 maximum forward-path length. */
export const MAX_ADMIN_EMAIL_LENGTH = 254;

/** Shortest structurally valid address, for example `a@b.co`. */
export const MIN_ADMIN_EMAIL_LENGTH = 6;

/**
 * ASCII-only `local@domain.tld`. Separators in the local part must sit between
 * alphanumerics, so leading, trailing, and repeated separators are rejected.
 * Internationalized addresses are out of scope for back-office accounts; the
 * task that needs one must widen this deliberately, together with the database
 * constraint.
 */
const CANONICAL_PATTERN =
  /^[a-z0-9]+(?:[._+-][a-z0-9]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u;

export class InvalidAdminEmailError extends Error {
  constructor(message = 'Invalid admin email address.') {
    super(message);
    this.name = 'InvalidAdminEmailError';
  }
}

/** Returns true when `value` is already in canonical storage form. */
export function isCanonicalAdminEmail(value: string): boolean {
  return (
    value.length >= MIN_ADMIN_EMAIL_LENGTH &&
    value.length <= MAX_ADMIN_EMAIL_LENGTH &&
    CANONICAL_PATTERN.test(value)
  );
}

/**
 * Normalizes admin email input to canonical storage form.
 *
 * Every write and every lookup must go through this function so that a stored
 * identity and a login attempt agree on the same key.
 */
export function normalizeAdminEmail(input: string): string {
  const canonical = input.trim().toLowerCase();
  if (!isCanonicalAdminEmail(canonical)) {
    throw new InvalidAdminEmailError();
  }
  return canonical;
}
