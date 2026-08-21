/**
 * Persistence-facing auth session record (not a Prisma type).
 * AUTH-02 models User sessions only; Admin sessions arrive with Admin identity.
 */
export interface AuthSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAuthSessionInput {
  /**
   * Optional predetermined session id so opaque refresh tokens can bind to
   * `sessionId.secret` before persistence (AUTH-07 session mint).
   */
  id?: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  lastUsedAt?: Date | null;
}

export interface RotateRefreshTokenHashInput {
  sessionId: string;
  tokenFamilyId: string;
  currentRefreshTokenHash: string;
  newRefreshTokenHash: string;
  now: Date;
  /**
   * Retention bound for the consumed previous digest row.
   * Typically the session `expiresAt` at rotation time.
   */
  consumptionExpiresAt: Date;
}

/**
 * Consumed refresh-token digest retained for reuse detection.
 * Bounded by `expiresAt` for later cleanup (DATA-02); not indefinite retention.
 */
export interface AuthRefreshTokenConsumptionRecord {
  id: string;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  consumedAt: Date;
  expiresAt: Date;
}

/**
 * Concurrent refresh of the same current RT can lose the conditional update
 * while the winner records consumption. Digests consumed within this window
 * are treated as a lost race (`AUTH_INVALID_TOKEN`), not confirmed reuse.
 */
export const REFRESH_REUSE_RACE_GRACE_MS = 10_000;
