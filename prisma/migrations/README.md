# Prisma migrations

Business migrations live here and are applied with `prisma migrate deploy`.

| Migration                                       | Purpose                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `20260820200000_auth_user_session`              | AUTH-02 User + AuthSession persistence foundation                 |
| `20260820210000_auth_refresh_token_consumption` | AUTH-04 bounded consumed refresh digests for reuse detection      |
| `20260821170000_admin_identity`                 | ADM-00 Admin identity persistence                                 |
| `20260821210000_admin_auth_session`             | ADM-AUTH-01 Admin refresh sessions                                |
| `20260821220000_category_region_reference`      | CAT-02 Category and Region reference tables                       |
| `20260821230000_product_catalog`                | CAT-03 Product catalog table                                      |
| `20260821240000_media_library`                  | CAT-04 Media library metadata                                     |
| `20260822120000_inventory_persistence`          | INV-01B Inventory, reservation, and ledger tables                 |
| `20260822140000_inventory_command_idempotency`  | INV-02 Admin inventory command idempotency claims                 |
| `20260822150000_order_persistence`              | ORD-01 Order / OrderLine historical snapshots                     |
| `20260822160000_price_history`                  | PRC-01 Product price history                                      |
| `20260822170000_discount_persistence`           | PRC-02 Discount model                                             |
| `20260822180000_order_pricing_snapshots`        | ORD-03 Order pricing / discount snapshot columns                  |
| `20260825120000_commerce_policy`                | COM-02 Commerce settings + schedule overrides                     |
| `20260825200000_order_commerce_policy_revision` | COM-03 Order.commercePolicyRevision                               |
| `20260825220000_discount_lifetime_usage`        | DLU-02 lifetime caps, usage aggregate/records, discountedQuantity |
| `20260827090000_deferred_settlement`            | SET-02 OrderSettlement lifecycle and receipt references           |
| `20260828180000_referral_visitor_persistence`   | REF-02 Visitor codes and immutable registration attribution       |
| `20260828200000_referral_code_invariants`       | REF-02 canonical code checks and database immutability guard      |

Integration suites apply migrations with `prisma migrate deploy` against `TEST_DATABASE_URL`. Do not use `prisma db push` as the canonical path.

## LOCAL-PG-01 migration evidence (2026-08-24)

Repository history shows `20260821240000_media_library` was introduced in `d39ea20` and its invalid `CHR(0)` check was corrected in `ac06b87`. The dedicated local `eggship_test` database reports the corrected migration as finished with one applied step and no rollback. Repository and local-test evidence cannot prove whether any shared staging/production environment attempted the earlier checksum. A human must inspect each shared environment's `_prisma_migrations` row and schema state before its next deploy; do not infer safety or invent a forward migration without that audit.
