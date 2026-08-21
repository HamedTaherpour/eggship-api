/** SHA-256 digest encoded as base64url is always 43 characters. */
export const REFRESH_TOKEN_HASH_LENGTH = 43;

export function isRefreshTokenHashShape(value: string): boolean {
  return (
    value.length === REFRESH_TOKEN_HASH_LENGTH &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

export function assertRefreshTokenHash(value: string): void {
  if (!isRefreshTokenHashShape(value)) {
    throw new Error(
      `refreshTokenHash must be a ${REFRESH_TOKEN_HASH_LENGTH}-character base64url digest.`,
    );
  }
}
