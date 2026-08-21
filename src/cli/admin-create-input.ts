import { isAdminRole, type AdminRole } from '../common/authz/admin-role';
import { normalizeAdminEmail } from '../modules/admins/domain/admin-email';
import { assertAdminPasswordPolicy } from '../modules/admins/domain/admin-password-policy';

export interface AdminCreateInput {
  email: string;
  password: string;
  role: AdminRole;
}

/**
 * Parses operator-supplied Admin creation fields.
 * Role must be an explicit known AdminRole; there is no default.
 * Does not print or return values for logging.
 */
export function parseAdminCreateInput(input: {
  email: string | undefined;
  password: string | undefined;
  role: string | undefined;
}): AdminCreateInput {
  if (input.email === undefined || input.email.trim() === '') {
    throw new Error(
      'Email is required (--email or EGGSHIP_ADMIN_CREATE_EMAIL).',
    );
  }
  if (input.password === undefined || input.password === '') {
    throw new Error(
      'Password is required (hidden prompt or EGGSHIP_ADMIN_CREATE_PASSWORD).',
    );
  }
  if (input.role === undefined || input.role.trim() === '') {
    throw new Error(
      'Role is required (--role or EGGSHIP_ADMIN_CREATE_ROLE). There is no default.',
    );
  }

  const email = normalizeAdminEmail(input.email);
  assertAdminPasswordPolicy(input.password);
  const role = input.role.trim();
  if (!isAdminRole(role)) {
    throw new Error('Unknown admin role. Pass an explicit known AdminRole.');
  }

  return {
    email,
    password: input.password,
    role,
  };
}
