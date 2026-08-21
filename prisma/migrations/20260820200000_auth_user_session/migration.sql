-- AUTH-02: User identity and AuthSession refresh persistence.
-- Empty/new database; additive only. No data backfill required.

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(43) NOT NULL,
    "tokenFamilyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- Canonical Iranian E.164 mobile only (+989 followed by 9 digits).
ALTER TABLE "User"
ADD CONSTRAINT "User_phone_iran_e164_check"
CHECK ("phone" ~ '^\+989[0-9]{9}$');

-- SHA-256 base64url digests are fixed length 43.
ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_refreshTokenHash_len_check"
CHECK (char_length("refreshTokenHash") = 43);

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");

CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

CREATE INDEX "AuthSession_tokenFamilyId_idx" ON "AuthSession"("tokenFamilyId");

CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- Prefer deactivation over hard-delete; Restrict prevents orphan-session deletes via user CASCADE.
ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
