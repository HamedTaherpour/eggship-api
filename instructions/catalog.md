# Catalog and reference resources

Durable boundaries for EggShip catalog and geography reference data. Field-level contracts belong in OpenAPI and Prisma; this file records ownership and lifecycle rules that must not drift.

## Owned resources

| Resource   | Module                   | Public                                             | Admin manage                                          |
| ---------- | ------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| `Category` | `src/modules/categories` | `GET /api/v1/categories` (active full list)        | `GET/POST/PATCH /api/v1/admin/categories`             |
| `Region`   | `src/modules/regions`    | `GET /api/v1/regions` (active full list)           | `GET/POST/PATCH /api/v1/admin/regions`                |
| `Product`  | `src/modules/products`   | `GET /api/v1/products`, `GET /api/v1/products/:id` | `GET/POST/PATCH /api/v1/admin/products` (+ `GET :id`) |

Categories and Regions remain **independent** reference modules. Product references Category via FK (`ON DELETE RESTRICT`). Inventory quantities are **not** Product fields ([inventory.md](inventory.md), INV-01B). Media is a reusable library (CAT-04); Product/Blog attachment is later work.

## Product boundaries (CAT-03)

- **Current price** is an integer number of **Toman** (not Rial). API field name: `price`. See [ADR 0010](../docs/adr/0010-integer-toman-money.md).
- Product owns catalog identity, Category relationship, current selling price, and `isActive` visibility — not stock, reservations, discounts, or order history. Product creation composes through Inventory `ensureForProduct` so every Product has a 0/0 Inventory row (INV-01B). Product HTTP responses do not include inventory fields.
- **Public visibility:** a product is public only when `Product.isActive` **and** its Category is active. Inactive categories may still be assigned in Admin; those products stay hidden from public APIs.
- Prefer **deactivation** over hard delete. No Product DELETE HTTP endpoint in CAT-03.
- Changing current Product `name` / `price` must not mutate historical Orders; Orders snapshot title and unit price at creation (ORD-01). PriceHistory is PRC-01.
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

- Public Category/Region lists are **full active sets** ordered by `name` ascending (tiny datasets; not mechanically paginated).
- Public Product lists are **paginated** (products can grow): `page`, `pageSize`, `search` (name), `sortBy`/`sortOrder` allowlist (`name`, `price`, `createdAt`, `updatedAt`; default `name`/`asc`), optional `categoryId`.
- Admin lists use CAT-01 primitives. Product Admin defaults: `createdAt`/`desc`; optional `categoryId` and `isActive`.
- Unknown query parameters are rejected.

## Legacy evidence

In-repository legacy Category/Region/Product field inventory does not exist yet (`MIG-01` PLANNED). Schemas stay minimal. Do not invent SKU, description, unit/package, slug, hierarchy, SEO, name uniqueness, or Product media columns without evidence.
