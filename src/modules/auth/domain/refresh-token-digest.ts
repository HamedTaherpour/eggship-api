import { createHash, randomBytes } from 'node:crypto';

/**
 * Digests high-entropy refresh tokens for durable session lookup.
 * Prefer this over password hashing (Argon2) for refresh-token storage.
 */
export function digestRefreshToken(rawToken: string): string {
  if (rawToken.length === 0) {
    throw new Error('Refresh token must not be empty.');
  }

  return createHash('sha256').update(rawToken, 'utf8').digest('base64url');
}

/**
 * Generates a high-entropy opaque secret fragment.
 * Prefer {@link RefreshTokenService.issueRefreshToken} for session-bound refresh tokens
 * (`sessionId.secret`). Do not persist this value as a standalone refresh token.
 */
export function generateRefreshToken(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 32) {
    throw new Error('Refresh token entropy must be at least 32 bytes.');
  }

  return randomBytes(byteLength).toString('base64url');
}
