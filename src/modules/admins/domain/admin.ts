import type { AdminRole } from '../../../common/authz/admin-role';

/**
 * Persistence-facing admin identity record (not a Prisma type).
 *
 * `passwordHash` is deliberately absent: nothing outside the credential path
 * needs it, and omitting it means it cannot reach a response DTO or a log by
 * accident. The task that adds Admin login introduces a separate, explicitly
 * named credential read.
 */
export interface AdminRecord {
  id: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The only state the authorization path reads. It excludes the email so an
 * authorization decision never loads operator PII.
 *
 * `role` is `string` because it crosses the persistence boundary:
 * `AuthorizationService` narrows it and denies an unrecognized value.
 */
export interface AdminAuthorizationState {
  id: string;
  role: string;
  isActive: boolean;
}

/**
 * Credential read for Admin password login. `passwordHash` is confined to this
 * type so identity DTOs and authorization state cannot accidentally carry it.
 */
export interface AdminLoginCredential {
  id: string;
  passwordHash: string;
  isActive: boolean;
}

/**
 * Creation input. `role` and `isActive` are security-sensitive and are never
 * populated from client-supplied request data; see `instructions/security.md`.
 */
export interface CreateAdminInput {
  email: string;
  passwordHash: string;
  role: AdminRole;
  isActive?: boolean;
}
