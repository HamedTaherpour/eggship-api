-- COM-03: persist the Commerce policy revision observed at Order create.
-- Additive and nullable for pre-COM-03 rows; application always sets a positive
-- revision on new creates. CHECK rejects zero/negative when present.
-- Human review is required before shared-environment deployment.

ALTER TABLE "Order" ADD COLUMN "commercePolicyRevision" INTEGER;

ALTER TABLE "Order" ADD CONSTRAINT "Order_commercePolicyRevision_check"
  CHECK ("commercePolicyRevision" IS NULL OR "commercePolicyRevision" >= 1);
