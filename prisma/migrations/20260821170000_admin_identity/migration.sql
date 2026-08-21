-- Admin identity foundation: back-office operator identity, credential, role, and lifecycle.
-- Additive only: creates one new enum type and one new table. No existing table, column,
-- constraint, or index is altered, so there is no backfill and no data-loss risk.
-- Rollback is DROP TABLE "Admin" + DROP TYPE "AdminRole" while the table is unused.

-- Values must stay exactly the code-defined AdminRole (src/common/authz/admin-role.ts).
-- Adding a role later is a non-destructive ALTER TYPE ... ADD VALUE.
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'WAREHOUSE', 'ORDER_OPS');

CREATE TABLE "Admin" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "AdminRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- Canonical email is authoritative in the database, not only in application code:
-- lowercase, no surrounding whitespace, exactly one '@', a dotted domain, and no
-- internal whitespace. The application validator is deliberately stricter (ASCII
-- local/domain shape), so anything it accepts also satisfies this constraint.
ALTER TABLE "Admin"
ADD CONSTRAINT "Admin_email_canonical_check"
CHECK (
    "email" = lower("email")
    AND "email" = btrim("email")
    AND char_length("email") BETWEEN 6 AND 254
    AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
);

-- Guards against an empty or truncated credential being stored. Argon2id encoded
-- digests are far longer; the bound stays algorithm-independent for future rehashing.
ALTER TABLE "Admin"
ADD CONSTRAINT "Admin_passwordHash_present_check"
CHECK (char_length("passwordHash") >= 16);

-- Uniqueness of the canonical email is the authoritative concurrency control:
-- two simultaneous creations of the same identity cannot both commit.
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
