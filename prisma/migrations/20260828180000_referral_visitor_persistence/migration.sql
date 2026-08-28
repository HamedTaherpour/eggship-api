-- REF-02: PostgreSQL-authoritative Visitor codes and immutable registration attribution.
CREATE TYPE "ReferralSource" AS ENUM ('VISITOR');

CREATE TABLE "Visitor" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "referralCode" VARCHAR(12) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralAttribution" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" "ReferralSource" NOT NULL,
    "visitorId" UUID NOT NULL,
    "referralCode" VARCHAR(12) NOT NULL,
    "attributedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralAttribution_visitor_source_check" CHECK ("source" = 'VISITOR')
);

CREATE UNIQUE INDEX "Visitor_referralCode_key" ON "Visitor"("referralCode");
CREATE INDEX "Visitor_isActive_createdAt_id_idx" ON "Visitor"("isActive", "createdAt", "id");
CREATE UNIQUE INDEX "ReferralAttribution_userId_key" ON "ReferralAttribution"("userId");
CREATE INDEX "ReferralAttribution_visitorId_attributedAt_id_idx" ON "ReferralAttribution"("visitorId", "attributedAt", "id");
CREATE INDEX "ReferralAttribution_source_attributedAt_id_idx" ON "ReferralAttribution"("source", "attributedAt", "id");

ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_visitorId_fkey"
  FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
