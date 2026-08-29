# Catalog and reference resources

Durable boundaries for EggShip catalog and geography reference data. Field-level contracts belong in OpenAPI and Prisma; this file records ownership and lifecycle rules that must not drift.

## Owned resources

| Resource   | Module                   | Public                                             | Admin manage                                          |
| ---------- | ------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| `Category` | `src/modules/categories` | `GET /api/v1/categories` (active full list)        | `GET/POST/PATCH /api/v1/admin/categories`             |
| `Region`   | `src/modules/regions`    | `GET /api/v1/regions` (active full list)           | `GET/POST/PATCH /api/v1/admin/regions`                |
| `Product`  | `src/modules/products`   | `GET /api/v1/products`, `GET /api/v1/products/:id` | `GET/POST/PATCH /api/v1/admin/products` (+ `GET :id`) |

Categories and Regions remain **independent** reference modules. Product references Category via FK (`ON DELETE RESTRICT`). Inventory quantities are **not** Product fields ([inventory.md](inventory.md), INV-01B). Media is a reusable library (CAT-04); Product/Blog/catalog Category attachment is later work (MED-01). Blog Media direction (cover, avatar, inline directives) is [ADR 0021](../docs/adr/0021-blog-content-architecture.md); public Product responses do not include media fields.

## Public catalog contract (CAT-06)

CAT-06 closes the public Category/Product storefront contract on top of CAT-02/CAT-03. Behavior below is authoritative for public routes.

### Visibility

- Public Category list returns **active** rows only (`isActive = true`).
- A Product is public only when `Product.isActive` **and** its Category is active.
- Public Product detail for inactive products, missing ids, or products under inactive categories returns `PRODUCT_NOT_FOUND` (no existence leak of hidden catalog rows).
- Inactive Categories may still be assigned in Admin; those products stay hidden from public APIs.

### Public Category list

- Full active set ordered by `name` ascending (tiny reference dataset; **not** paginated).
- No public Category detail route until MIG-01 evidences a storefront need.
- **No query parameters** are accepted; unknown query parameters are rejected (`forbidNonWhitelisted`).
- Response fields: `id`, `name` only (no `isActive`, timestamps, or Admin extras).

### Public Product list / detail

- List is **paginated** with CAT-01 primitives: `page`, `pageSize`, optional `search` (**name** only), `sortBy`/`sortOrder` allowlist (`name`, `price`, `createdAt`, `updatedAt`; default `name`/`asc`), optional `categoryId` filter.
- `isActive` is **not** a public filter. Unknown query parameters are rejected.
- Detail returns the same public fields as list items.
- Response fields: `id`, `name`, `price` (integer Toman), `categoryId` only.
- List/detail queries filter Category activity in the Product query (`category: { isActive: true }`) and do **not** hydrate nested Category rows per product (N+1-safe). Public responses expose `categoryId` only.
- Do not load Inventory or Pricing/discount calculation data on public catalog routes. Do not add Redis caching here.

### Region note

Public Region list remains the CAT-02 active full list (same shape as Category). CAT-06 does not change Region contracts.

## Product boundaries (CAT-03)

- **Current price** is an integer number of **Toman** (not Rial). API field name: `price`. See [ADR 0010](../docs/adr/0010-integer-toman-money.md).
- Product owns catalog identity, Category relationship, current selling price, and `isActive` visibility — not stock, reservations, discounts, or order history. Product creation composes through Inventory `ensureForProduct` so every Product has a 0/0 Inventory row (INV-01B). Product HTTP responses do not include inventory fields. **Price mutations** route through `PricingService` and append immutable `PriceHistory` ([pricing.md](pricing.md), PRC-01).
- Prefer **deactivation** over hard delete. No Product DELETE HTTP endpoint in CAT-03.
- Changing current Product `name` / `price` must not mutate historical Orders; Orders snapshot title and unit price at creation (ORD-01). Price changes append immutable `PriceHistory` via `PricingService` (PRC-01; see [pricing.md](pricing.md)).
- Admin Product create/update/price/status changes are **auditable candidates** for AUD-01; do not invent AuditLog rows here.

## Permissions

Admin routes use AUTH-08 permissions:

- `CATALOG_READ` — Admin list/detail
- `CATALOG_MANAGE` — create and update (including activation and price changes)

Do not role-check in controllers. `SUPER_ADMIN` receives these only through the central role policy enumeration.

## Lifecycle

- Prefer **deactivation** (`isActive = false`) over hard delete. No DELETE HTTP endpoints for Category, Region, or Product in the current catalog tasks.
- Public lists return **active** rows only (Products also require an active Category).
- Category deletion is restricted while Products reference it (`ON DELETE RESTRICT`).

## List semantics

- Public Category/Region lists are **full active sets** ordered by `name` ascending (tiny datasets; not mechanically paginated). Public Category rejects all query parameters.
- Public Product lists are **paginated** (products can grow): `page`, `pageSize`, `search` (name), `sortBy`/`sortOrder` allowlist (`name`, `price`, `createdAt`, `updatedAt`; default `name`/`asc`), optional `categoryId`.
- Admin lists use CAT-01 primitives. Product Admin defaults: `createdAt`/`desc`; optional `categoryId` and `isActive`.
- Unknown query parameters are rejected on public Product lists, public Category lists, and Admin catalog lists. Public Region list still accepts no query DTO (CAT-02); hardening it to the same empty-query pattern is a follow-up, not CAT-06.

## Legacy evidence / MIG-01 deltas (public contract)

In-repository legacy Category/Region/Product field inventory does not exist yet (`MIG-01` PLANNED). Schemas and public DTOs stay minimal. Do **not** invent the following without MIG-01 evidence:

| Topic                           | Current public contract                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| SKU / product code              | Absent                                                                                                                              |
| Description / rich content      | Absent                                                                                                                              |
| Slug / SEO                      | Absent                                                                                                                              |
| Category hierarchy / sortOrder  | Flat list by `name` only                                                                                                            |
| Package / unit semantics        | Absent                                                                                                                              |
| Product media / gallery         | Absent (MED-01); no media fields on public Product                                                                                  |
| Zero-price products             | Rejected (`price > 0`)                                                                                                              |
| Name uniqueness                 | Not enforced                                                                                                                        |
| Public Category detail          | Not offered                                                                                                                         |
| Public Category pagination      | Not offered (full active set)                                                                                                       |
| Nested category on Product      | `categoryId` only                                                                                                                   |
| Inventory on Product            | Never (INV owns stock)                                                                                                              |
| Personalized / discounted price | Order/create pricing via PRC-05 `OrderPricingService` (ADR 0015); public catalog list/detail still expose base `Product.price` only |

Record migration mapping differences against legacy when MIG-01 inventories the source system; do not invent parity fields to “look complete.”
