-- ADM-AUTH-01: Admin refresh sessions and consumed-digest reuse detection.
-- Additive only: two new tables. No existing table, column, constraint, or index
-- is altered. `AuthSession.userId` stays a non-nullable FK to User (ADR 0008 / 0009).
-- Rollback while unused: DROP TABLE "AdminAuthRefreshTokenConsumption";
-- DROP TABLE "AdminAuthSession".

CREATE TABLE "AdminAuthSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(43) NOT NULL,
    "tokenFamilyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminAuthSession_pkey" PRIMARY KEY ("id")
);

-- SHA-256 base64url digests are fixed length 43. Never store plaintext tokens.
ALTER TABLE "AdminAuthSession"
ADD CONSTRAINT "AdminAuthSession_refreshTokenHash_len_check"
CHECK (char_length("refreshTokenHash") = 43);

CREATE UNIQUE INDEX "AdminAuthSession_refreshTokenHash_key"
ON "AdminAuthSession"("refreshTokenHash");

CREATE INDEX "AdminAuthSession_adminId_revokedAt_idx"
ON "AdminAuthSession"("adminId", "revokedAt");

CREATE INDEX "AdminAuthSession_tokenFamilyId_idx"
ON "AdminAuthSession"("tokenFamilyId");

CREATE INDEX "AdminAuthSession_expiresAt_idx"
ON "AdminAuthSession"("expiresAt");

-- Prefer deactivation over hard-delete; Restrict prevents orphan-session deletes
-- via casual Admin CASCADE. ADM-01 owns disablement + session revocation.
ALTER TABLE "AdminAuthSession"
ADD CONSTRAINT "AdminAuthSession_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AdminAuthRefreshTokenConsumption" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenFamilyId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(43) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminAuthRefreshTokenConsumption_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminAuthRefreshTokenConsumption"
ADD CONSTRAINT "AdminAuthRefreshTokenConsumption_refreshTokenHash_len_check"
CHECK (char_length("refreshTokenHash") = 43);

CREATE UNIQUE INDEX "AdminAuthRefreshTokenConsumption_refreshTokenHash_key"
ON "AdminAuthRefreshTokenConsumption"("refreshTokenHash");

CREATE INDEX "AdminAuthRefreshTokenConsumption_tokenFamilyId_idx"
ON "AdminAuthRefreshTokenConsumption"("tokenFamilyId");

CREATE INDEX "AdminAuthRefreshTokenConsumption_sessionId_idx"
ON "AdminAuthRefreshTokenConsumption"("sessionId");

CREATE INDEX "AdminAuthRefreshTokenConsumption_expiresAt_idx"
ON "AdminAuthRefreshTokenConsumption"("expiresAt");
