-- AUTH-04: Bounded consumed refresh-token digests for reuse detection.
-- Additive only. Retention is expiresAt; cleanup jobs are deferred (DATA-02).

CREATE TABLE "AuthRefreshTokenConsumption" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenFamilyId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(43) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthRefreshTokenConsumption_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuthRefreshTokenConsumption"
ADD CONSTRAINT "AuthRefreshTokenConsumption_refreshTokenHash_len_check"
CHECK (char_length("refreshTokenHash") = 43);

CREATE UNIQUE INDEX "AuthRefreshTokenConsumption_refreshTokenHash_key"
ON "AuthRefreshTokenConsumption"("refreshTokenHash");

CREATE INDEX "AuthRefreshTokenConsumption_tokenFamilyId_idx"
ON "AuthRefreshTokenConsumption"("tokenFamilyId");

CREATE INDEX "AuthRefreshTokenConsumption_sessionId_idx"
ON "AuthRefreshTokenConsumption"("sessionId");

CREATE INDEX "AuthRefreshTokenConsumption_expiresAt_idx"
ON "AuthRefreshTokenConsumption"("expiresAt");
