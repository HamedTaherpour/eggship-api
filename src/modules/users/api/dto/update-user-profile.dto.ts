/**
 * AUTH-07 profile update allowlist.
 *
 * No mutable business profile fields are evidenced in-repo yet (MIG-01 pending).
 * Identity/security fields (id, phone, isActive, timestamps) are intentionally absent.
 * An empty JSON object is valid; unknown properties are rejected by ValidationPipe
 * (`whitelist` + `forbidNonWhitelisted`).
 *
 * Future Orders capture immutable shipping snapshots from profile state at order time;
 * mutating address later must not rewrite historical Order snapshots.
 */
export class UpdateUserProfileBodyDto {}
