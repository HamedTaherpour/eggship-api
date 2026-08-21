/**
 * Opaque refresh token material. Persist only {@link digest}; never store rawToken.
 */
export interface IssuedRefreshToken {
  rawToken: string;
  digest: string;
  sessionId: string;
}

export interface ParsedRefreshToken {
  sessionId: string;
}
