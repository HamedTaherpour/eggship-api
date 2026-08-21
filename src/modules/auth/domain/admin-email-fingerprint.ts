import { createHmac } from 'node:crypto';

/**
 * Keyed fingerprint of a canonical Admin email for abuse-control keys.
 * Never log the email or the fingerprint in unrestricted diagnostics.
 */
export function fingerprintAdminLoginEmail(
  canonicalEmail: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update('admin-login-email\0')
    .update(canonicalEmail, 'utf8')
    .digest('base64url');
}
