/**
 * Persistence-facing Admin refresh session (not a Prisma type).
 * Dedicated from `AuthSessionRecord` so User and Admin subjects cannot be
 * confused at the type or table boundary (ADR 0009).
 */
export interface AdminAuthSessionRecord {
  id: string;
  adminId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAdminAuthSessionInput {
  /**
   * Optional predetermined session id so opaque refresh tokens can bind to
   * `sessionId.secret` before persistence.
   */
  id?: string;
  adminId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  lastUsedAt?: Date | null;
}

export interface RotateAdminRefreshTokenHashInput {
  sessionId: string;
  tokenFamilyId: string;
  currentRefreshTokenHash: string;
  newRefreshTokenHash: string;
  now: Date;
  consumptionExpiresAt: Date;
}

export interface AdminAuthRefreshTokenConsumptionRecord {
  id: string;
  sessionId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  consumedAt: Date;
  expiresAt: Date;
}
