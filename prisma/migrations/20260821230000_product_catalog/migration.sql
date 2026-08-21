-- CAT-03: Product catalog table with integer Toman price and Category FK.
-- Additive only: one new table, indexes, and Category relation. No existing
-- columns altered. No inventory fields on Product (INV-01). No media FK
-- (CAT-04). No name/SKU uniqueness (MIG-01 evidence pending).
-- Rollback while unused: DROP TABLE "Product";

CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "price" INTEGER NOT NULL,
    "categoryId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- Trimmed, non-empty display name. Application also trims on write.
ALTER TABLE "Product"
ADD CONSTRAINT "Product_name_trimmed_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 100
);

-- Current selling price is integer Toman; must be strictly positive.
-- Zero/negative prices are rejected at DB and application layers.
ALTER TABLE "Product"
ADD CONSTRAINT "Product_price_positive_check"
CHECK ("price" > 0);

-- Category must exist; deleting a Category that still has Products is blocked.
ALTER TABLE "Product"
ADD CONSTRAINT "Product_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Product_categoryId_isActive_idx" ON "Product"("categoryId", "isActive");

CREATE INDEX "Product_isActive_createdAt_idx" ON "Product"("isActive", "createdAt");
