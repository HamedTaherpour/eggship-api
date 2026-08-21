/**
 * Admin password policy.
 *
 * Length-oriented policy adopted for Admin creation and bootstrap (ADM-AUTH-01):
 * a minimum length, an upper bound, and no composition rules. Character-class
 * requirements measurably push operators toward predictable substitutions
 * without adding entropy, so they are not imposed.
 *
 * Deferred: breached-password corpus rejection, and rotation/expiry. Login
 * throttling is implemented in Auth, not here. Recorded in
 * `instructions/authentication.md`.
 */

/** Minimum length. Short enough to be memorable, long enough to resist offline guessing with Argon2id. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound. Mirrors `MAX_PASSWORD_LENGTH` in the Argon2 hasher, which
 * bounds hashing work per request; a spec asserts the two do not drift.
 */
export const MAX_ADMIN_PASSWORD_LENGTH = 128;

export class WeakAdminPasswordError extends Error {
  constructor(message = 'Admin password does not meet the minimum policy.') {
    super(message);
    this.name = 'WeakAdminPasswordError';
  }
}

/**
 * Throws when the password violates policy. The message never contains the
 * password, and callers must not log the candidate value.
 */
export function assertAdminPasswordPolicy(password: string): void {
  if (
    password.length < MIN_ADMIN_PASSWORD_LENGTH ||
    password.length > MAX_ADMIN_PASSWORD_LENGTH
  ) {
    throw new WeakAdminPasswordError();
  }
}
