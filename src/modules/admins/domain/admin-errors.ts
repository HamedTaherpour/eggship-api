/**
 * Admin domain failures.
 *
 * These are plain domain errors rather than `AuthError` values on purpose:
 * ADM-01 adds no HTTP surface, and choosing a status code or a client-visible
 * error code belongs to the task that exposes an endpoint. In particular, a
 * duplicate-email conflict must not become a pre-authentication response that
 * discloses whether an admin email exists.
 */

/** The canonical email is already taken. Raised from the database unique constraint. */
export class AdminEmailAlreadyExistsError extends Error {
  constructor(message = 'An admin with this email already exists.') {
    super(message);
    this.name = 'AdminEmailAlreadyExistsError';
  }
}

/**
 * A persisted role is not a known `AdminRole`, which means the database enum and
 * the code-defined roles have drifted. Full-record reads fail loudly; the
 * authorization path never throws for this and denies with `unknown_role`.
 */
export class UnknownAdminRoleError extends Error {
  constructor(message = 'Persisted admin role is not a known AdminRole.') {
    super(message);
    this.name = 'UnknownAdminRoleError';
  }
}
