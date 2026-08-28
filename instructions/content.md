# Blog and public content

Durable boundaries for EggShip public blog content. Field-level HTTP contracts belong in OpenAPI and Prisma; this file records publication, slug, time, and Media boundaries that must not drift.

CNT-01 implements Blog persistence and public published list/detail. Admin create/edit/publish is [CNT-02](../docs/ROADMAP.md). Redis caching is not implemented.

## Owned resource

| Resource | Module              | Public                                         | Admin manage |
| -------- | ------------------- | ---------------------------------------------- | ------------ |
| `Blog`   | `src/modules/blogs` | `GET /api/v1/blogs`, `GET /api/v1/blogs/:slug` | CNT-02       |

## Publication eligibility

A Blog is publicly visible **only** when `isPublished = true`.

This predicate is defined once as `publishedBlogWhere` / `isBlogPubliclyVisible` and is used for:

- public list items
- public detail
- title search matches
- pagination `total` / `totalPages`

Drafts and unpublished rows must not leak through a different error, a different count, or a related-media representation.

`publishedAt` is **not** compared to the current time. A published post with a future `publishedAt` remains public. Scheduled publishing is not a CNT-01 feature and remains unapproved for CNT-02 unless evidenced.

## Slug semantics

- Caller-provided. The API does not generate slugs from titles.
- Canonical persisted form: trimmed lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), length 1–120.
- Unique across **all** rows, including drafts, so a later publish cannot collide.
- Public detail looks up the canonical form. Invalid format → `BLOG_INVALID_SLUG` (400). Missing and unpublished slugs both → `BLOG_NOT_FOUND` (404) with the same message.
- No slug history or redirect table.

## Date and time

- `publishedAt`, `createdAt`, and `updatedAt` are PostgreSQL `timestamptz` (UTC instants).
- Public JSON uses ISO 8601. Clients may display Tehran wall-clock; the backend does not persist Jalali or Tehran-local strings.
- Business timezone `Asia/Tehran` is used by Commerce policy, not by Blog publication eligibility.

## Public contract

- List is paginated with CAT-01 primitives: `page`, `pageSize`, optional `search` (**title** only), `sortBy`/`sortOrder` allowlist (`publishedAt`, `title`, `createdAt`; default `publishedAt`/`desc`) with a stable `id` tie-break.
- `isPublished` is **not** a public filter. Unknown query parameters are rejected.
- List fields: `id`, `slug`, `title`, `publishedAt`. Body is omitted from list pages (not an excerpt field).
- Detail fields: `id`, `slug`, `title`, `body`, `publishedAt`.
- Body is stored markup (HTML or Markdown). This API does not sanitize or render it. XSS prevention belongs to the storefront renderer.
- Public catalog cache policy applies: CNT-01 does not set `Cache-Control: no-store` and does not add Redis caching.

## Media boundary

CNT-01 has **no** Blog → Media relationship. CAT-04 owns Media metadata. MED-01 owns Product/Blog/Category attachment, historical-reference rules, and orphan cleanup.

CNT-01 “media history is preserved” by **not** inventing an attachment model that would replace or delete Media rows. Do not add polymorphic attachments here.

## CNT-02 responsibilities

- Authorized create/edit/publish/unpublish
- Slug-conflict HTTP
- Explicit state transitions
- Scheduling only if evidenced
- Audit hooks
- Admin OpenAPI

`CONTENT_READ` / `CONTENT_MANAGE` already exist in the AUTH-08 catalog and are unused until CNT-02 attaches Admin routes.

## Persistence notes

Repository `create` is an internal persistence helper for tests and CNT-02. CNT-01 exposes no write HTTP and therefore has no mass-assignment surface.

## Legacy evidence / MIG-01 deltas

In-repository legacy Blog field inventory does not exist yet (`MIG-01` PLANNED). The schema stays at the CNT-01 minimum. Do **not** invent the following without evidence:

| Topic                        | Current contract                  |
| ---------------------------- | --------------------------------- |
| Author                       | Absent                            |
| Category / tags              | Absent                            |
| SEO metadata                 | Absent                            |
| Excerpt / reading time       | Absent (list simply omits `body`) |
| Comments / view counters     | Absent                            |
| Cover image / media gallery  | Absent (MED-01)                   |
| Scheduled publishing         | Absent (`isPublished` only)       |
| Soft-delete / revisions      | Absent                            |
| HTML vs Markdown distinction | Opaque `body` string              |
| Slug redirects on rename     | Absent                            |
