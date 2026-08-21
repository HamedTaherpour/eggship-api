# List queries

Canonical HTTP list/query semantics for EggShip Admin and public list endpoints. Keep this document aligned with [api-contract.md](api-contract.md). Shared primitives live under `src/common/list/`.

## Response envelope

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

Use `toPaginatedResponse(items, pageRequest, total)` (or equivalent) so metadata stays deterministic. Do not invent alternate list envelopes.

## Pagination

| Parameter  | Rules                        | Default |
| ---------- | ---------------------------- | ------: |
| `page`     | Integer, `>= 1`              |       1 |
| `pageSize` | Integer, `>= 1` and `<= 100` |      20 |

- Reject invalid values with the structured validation contract. Do **not** silently clamp (`page=0` is an error, not page 1).
- Offset helpers: `skip = (page - 1) * pageSize`, `take = pageSize`, `totalPages = ceil(total / pageSize)` with `totalPages = 0` when `total = 0`.
- `max pageSize = 100` is an API performance safeguard for ordinary lists.
- Page/offset pagination is the default. Cursor pagination may be introduced later for a demonstrated high-volume case only.
- Trade-off: offset pagination is simple for Admin UX and supports totals; deep offsets can become expensive at very large scale.
- Feature repositories own efficient `count` + page query behavior. Do not add a generic repository list method.

## Search

| Parameter | Rules                                                                                      |
| --------- | ------------------------------------------------------------------------------------------ |
| `search`  | Optional string; trimmed; bounded length (default max 200); empty/whitespace-only → absent |

- `search` is **not** “search every column.” Each resource explicitly defines searchable fields and query logic.
- Common primitives may trim/basic-normalize text only. Domain normalization (phone, SKU, …) stays in the owning module.

## Sorting

| Parameter   | Rules                                       |
| ----------- | ------------------------------------------- |
| `sortBy`    | Optional; must be in the resource allowlist |
| `sortOrder` | Optional; only `asc` or `desc`              |

- Build allowlists with `createSortQueryDto({ fields, defaultSortBy, defaultSortOrder })`.
- Unknown `sortBy` / `sortOrder` values fail validation.
- Never pass client `sortBy` strings directly into Prisma `orderBy`. Map allowlisted fields explicitly in the feature repository.
- Default sorting is resource-owned (often `createdAt desc`). There is no universal default field for every resource.

## Filters

- Filters are explicit, resource-specific query parameters (for example `categoryId`, `isActive`).
- Do **not** introduce operator DSLs (`filter[field][op][value]`), dynamic column filters, or GraphQL-like filter languages.
- Inclusive/exclusive range boundaries and timezone/business-day semantics are specified per resource.
- Optional date-range naming convention when a resource opts in: `createdFrom` / `createdTo` (and similarly `updatedFrom` / `updatedTo`) with ISO 8601 input. Do not encode Tehran time in common list utilities.

## Strict query validation

Global `ValidationPipe` uses `whitelist` + `forbidNonWhitelisted`. Unsupported list query parameters must fail validation rather than be ignored. Do not globally reject infrastructure parameters that routes legitimately need outside list DTOs.

## Numeric and boolean query parsing

HTTP query values arrive as strings.

- Integers: use `parseQueryInt` (or equivalent). Accept only decimal integer strings / safe integers. Reject decimals, trailing junk, scientific notation, hex, `NaN`, and `Infinity`.
- Booleans: use `parseQueryBoolean` when needed. Accept only `true` / `false` (boolean or lowercase string). Do not treat `1`, `yes`, or other values as truthy.

## DTO composition

Compose resource list query DTOs from:

- `PaginationQueryDto`
- `SearchQueryDto` (when search applies)
- resource sort DTO from `createSortQueryDto`
- explicit filter properties on the resource DTO

Prefer `IntersectionType` from `@nestjs/swagger` (or extending `PaginationQueryDto`) over speculative base CRUD classes. Resulting DTOs must remain class-validator / class-transformer / OpenAPI compatible.

## Persistence boundary

```text
HTTP query DTO
  → validated resource list query
  → application / repository
  → explicit Prisma where / orderBy / skip / take
```

Common list code must not export `Prisma.WhereInput`, `Prisma.OrderByWithRelationInput`, or other Prisma types. Repositories translate validated intent.

## OpenAPI

Document `page`, `pageSize`, `search`, `sortBy`, `sortOrder`, and resource filters with defaults, min/max, and enum allowlists. Use `PaginationMetaDto` / `createPaginatedResponseDto` for response schemas. Do not document arbitrary filter fields.

## Non-goals

Do not create `BaseCrudController`, `BaseCrudService`, `BaseRepository<T>`, automatic query-from-any-column frameworks, or production probe list endpoints.
