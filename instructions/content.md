# Blog and public content

Durable boundaries for EggShip public blog content. Field-level HTTP contracts belong in OpenAPI and Prisma; this file records publication, slug, time, Markdown, taxonomy, and Media boundaries that must not drift.

Architecture decisions are accepted in [ADR 0021](../docs/adr/0021-blog-content-architecture.md). CNT-01 implements Blog persistence and public published list/detail. CNT-02 delivers Admin create/edit/publish/unpublish. CNT-03 recorded this architecture (no schema). CNT-04 implements the approved content-model expansion. Redis caching is not implemented.

CNT-04 uses a dependency-free, fail-closed token scanner for the approved Markdown
profile. It stores Markdown source and never renders HTML; `::aparat` is validated
and `::media` is syntax-checked but not resolved or persisted until MED-01
([ADR 0022](../docs/adr/0022-media-attachment-and-reference-lifecycle.md)). TanStack
Markdown remains a frontend renderer candidate and is not a Nest dependency.

Blog write transactions use the lock order `Blog -> BlogAuthor -> BlogCategory -> BlogTag`
(CNT-04). MED-01 / ADR 0022 extends Media-touching Blog writes with sorted Media locks:
`Blog -> BlogAuthor -> BlogCategory -> BlogTag -> Media`. Taxonomy lifecycle mutations lock
only their own row, so author/category deactivation cannot form a reverse lock cycle with
publish or association replacement. Association existence and active-state checks run after
those locks and before the Blog write. Because CNT-04 was already applied to the isolated
test database when the author invariant was found, the invariant is delivered by a forward
`NOT VALID` PostgreSQL CHECK migration: legacy published rows remain readable, while every
new or updated row must satisfy `isPublished = false OR authorId IS NOT NULL`. MIG-01 owns
any later historical backfill and validation of the legacy exception.

## Owned resources

| Resource     | Module            | Public (current / future)                                                                         | Admin manage                      |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| Blog         | src/modules/blogs | GET /api/v1/blogs, GET /api/v1/blogs/:slug; CNT-04 may add category/tag filters and richer detail | CNT-02; CNT-04 extends allowlists |
| BlogAuthor   | src/modules/blogs | Future public author detail/list (CNT-04)                                                         | CNT-04                            |
| BlogCategory | src/modules/blogs | Future public category list/detail and Blog list-by-category (CNT-04)                             | CNT-04                            |
| BlogTag      | src/modules/blogs | Future public tag list/detail and Blog list-by-tag (CNT-04)                                       | CNT-04                            |

BlogCategory is **not** catalog Category. Do not store Blog taxonomy on src/modules/categories.

## Publication eligibility

A Blog is publicly visible **only** when isPublished = true.

This predicate is defined once as publishedBlogWhere / isBlogPubliclyVisible and is used for:

- public list items
- public detail
- title search matches
- pagination total / totalPages

Drafts and unpublished rows must not leak through a different error, a different count, or a related-media representation.

publishedAt is **not** compared to the current time. A published post with a future publishedAt remains public. Scheduled publishing is not approved.

## Slug semantics

- Caller-provided. The API does not generate slugs from titles (or from category/tag/author names).
- Canonical persisted form: trimmed lowercase kebab-case matching letters, digits, and single hyphens, length 1-120.
- Blog slugs are unique across **all** Blog rows, including drafts, so a later publish cannot collide.
- BlogCategory, BlogTag, and BlogAuthor slugs are unique within their own table (independent namespaces).
- Public Blog detail looks up the canonical form. Invalid format maps to BLOG_INVALID_SLUG (400). Missing and unpublished slugs both map to BLOG_NOT_FOUND (404) with the same message.
- No slug history or redirect table.
- Admin PATCH may change slug with the same normalization and uniqueness rules.

## Date and time

- publishedAt, createdAt, and updatedAt are PostgreSQL timestamptz (UTC instants).
- Public JSON uses ISO 8601. Clients may display Tehran wall-clock; the backend does not persist Jalali or Tehran-local strings.
- Business timezone Asia/Tehran is used by Commerce policy, not by Blog publication eligibility.

## Markdown source contract

Blog.body is Markdown source stored in the existing TEXT column. The backend does **not** convert body to final HTML and does not persist a rendered-HTML duplicate.

Authoring supports:

- Standard Markdown
- EggShip-controlled directives (Media, Aparat)

Authoring does **not** support relying on:

- raw executable HTML (script tags, arbitrary tags)
- raw iframe HTML
- arbitrary embed scripts or third-party HTML
- MDX/JSX execution

TanStack Markdown is the preferred **frontend** renderer candidate. Do not add it as a Nest dependency unless CNT-04/MED-01 prove a shared parser is required for Media-reference extraction.

Maximum stored body length remains the CNT-01 abuse bound (100_000 Unicode code points after trim). Internal Markdown whitespace is preserved; surrounding whitespace is trimmed with ECMAScript String.trim().

## Renderer and security contract

Pipeline:

Markdown source -> parser/AST -> allowlisted renderers/components

Storefront and Admin preview must render through components (or an equivalent non-trusted-HTML path), not by treating stored body as HTML. If TanStack Markdown is used, allowHtml stays disabled unless a later explicit security review approves otherwise. A Markdown library is not assumed to sanitize HTML produced by extensions.

Guardrails for CNT-04 and frontend implementation:

- XSS: never dangerouslySetInnerHTML (or SSR equivalent) on stored body.
- Directives must not emit author-supplied HTML attribute strings unchecked (quote-break / event-handler injection).
- Link schemes: allow https (and mailto only if kept as a documented CommonMark default). Reject javascript, data, and other unsafe schemes.
- Do not render arbitrary remote Markdown images — tracking and mixed-content risk. Inline images are Media directives only.
- Broken Media IDs: omit or use a safe placeholder; do not echo raw IDs into HTML in a way that becomes markup.
- Aparat: construct iframe src from an allowlisted host and validated identifier only.
- SSR: the same profile applies on the server; do not introduce a second HTML-string pipeline for SEO snapshots.
- Admin preview and storefront must share the profile so directive tampering cannot work in preview and vanish (or execute) in production.

The API continues to return Markdown source. XSS prevention belongs to the shared renderer, not to a backend HTML sanitizer of body.

## Custom directives

Conceptual forms (exact syntax is CNT-04):

    ::media[id="MEDIA_UUID" alt="..." caption="..."]
    ::aparat[id="ivejp35"]

Unknown directives fail closed (reject on save or leave unrendered). They must never become raw HTML. CNT-04 owns grammar and save-time validation. MED-01 owns durable Media IDs discovered from media directives.

Prefer an AST/parser for Media-ID extraction on save. Regex-only extraction is not the long-term authority.

## Inline Media

Blog articles support images inside the body via the Media directive. Do **not** persist storage/CDN URLs as the authoritative image identity.

Resolution: Media ID -> Media module -> derived public URL ([media.md](media.md)).

MED-01 (ADR 0022) owns the durable `(blogId, mediaId)` registry discovered with the CNT-04 token/directive model on save (not regex-as-authority). Until that registry ships, delete restriction cannot see inline references. Alt/caption remain in the Markdown directive; do not store them as global Media metadata. Missing Media IDs fail the Blog save with `MEDIA_NOT_FOUND` (no silent strip).

## Cover Media

One cover image: Blog.coverMediaId -> Media. Not an arbitrary URL. MED-01 / ADR 0022 define Restrict, `MEDIA_REFERENCED` on delete, replace-without-delete, and orphan coordination (DATA-02). Cover may be used as the social/OG image in the frontend unless a later SEO task adds an override.

CNT-04 shipped without Media FKs. MED-01 adds cover (and Author avatar / inline registry) in one additive migration.

## Aparat embeds

Authors paste an Aparat URL or video id; the editor stores an aparat directive. The renderer builds the approved iframe. Allowlist aparat.com and www.aparat.com and the documented embed path. Do not store raw Aparat scripts, AMP snippets, or arbitrary iframe markup as executable content. Do not server-side-fetch Aparat HTML as a rewrite step.

## Categories

BlogCategory: id, name, slug, description (plain text), isActive, createdAt, updatedAt. Many-to-many with Blog. No hierarchy.

A Blog may belong to multiple categories, including zero. Public taxonomy indexes return isActive = true only. Deactivation does not unpublish posts. New assignments must use an active category.

Name/description: trim; name required; description optional plain text (CNT-04 bounds; do not store Markdown).

## Tags

BlogTag: id, name, slug, description (plain text), timestamps. Many-to-many with Blog. A Blog may have multiple tags, including zero.

**No isActive.** There is no approved requirement to hide tags while keeping assignments. Delete is restricted while referenced.

## Excerpt

Dedicated editorial excerpt. Plain text, Unicode-trimmed, max 320 code points, null when empty. Not derived from body. Distinct from seoDescription. Optional on drafts. Public list may include excerpt once CNT-04 lands; until then list omits body and has no excerpt field.

## SEO metadata

V1 fields only:

- seoTitle optional, plain text, max 200 code points
- seoDescription optional, plain text, max 320 code points

Fallbacks: page title seoTitle ?? title; meta description seoDescription ?? excerpt. Canonical URL is route + slug. Do not add robots overrides, keyword fields, or social-network-specific title/description duplicates.

## Public Author

BlogAuthor: id, name, slug, optional plain-text bio, optional avatarMediaId, isActive, timestamps.

Blog.authorId -> BlogAuthor. Not an Admin FK. Published posts require an **active** author. Drafts may omit authorId until publish. Deactivation hides the author from public author indexes and blocks new assignment; existing published posts stay public and read the live author row (not a snapshot). Avatar lifecycle is MED-01 / ADR 0022 (`ON DELETE RESTRICT`; deactivation does not delete avatar Media).

## Editorial provenance

Internal operators and public Author are separate. Do not add createdByAdminId / updatedByAdminId / publishedByAdminId in CNT-04. Structured logs remain audit candidates for AUD-01/AUD-02. A future content-provenance task is required before denormalized Admin actor columns on Blog.

## Admin contract (CNT-02)

Permissions (AUTH-08):

- CONTENT_READ: Admin list/detail
- CONTENT_MANAGE: create, edit, publish, unpublish

CNT-04 continues to use these coarse grants for Author/category/tag admin unless MIG-01 evidences finer permissions. Do not role-check in controllers.

Routes (command endpoints for publication):

- GET /api/v1/admin/blogs — paginated list including drafts; optional search (title), sortBy/sortOrder allowlist, optional isPublished filter; unknown query params rejected.
- GET /api/v1/admin/blogs/:id — draft or published detail by UUID.
- POST /api/v1/admin/blogs — create **draft** only (isPublished=false, publishedAt=null).
- PATCH /api/v1/admin/blogs/:id — allowlisted fields: slug, title, body only until CNT-04 extends the allowlist.
- POST /api/v1/admin/blogs/:id/publish — explicit publish command.
- POST /api/v1/admin/blogs/:id/unpublish — explicit unpublish command.

Publication command semantics:

- **Publish (first time or republish after unpublish):** isPublished=true; publishedAt from authoritative server time (never client-supplied).
- **Publish replay:** idempotent; preserves existing publishedAt.
- **Unpublish:** isPublished=false; retains last publishedAt as publication history (does not erase history).
- **Unpublish replay:** idempotent on drafts.
- No scheduling worker, cron, or future-gate on publishedAt.

Slug conflicts map to stable BLOG_SLUG_CONFLICT (409). Admin identity comes from authenticated server context only.

Structured logs record create/update/publish/unpublish as auditable candidates once AUD-01 exists. No parallel AuditLog implementation in CNT-02 or CNT-04.

## Public contract (CNT-01, until CNT-04)

- List is paginated with CAT-01 primitives: page, pageSize, optional search (**title** only), sortBy/sortOrder allowlist (publishedAt, title, createdAt; default publishedAt/desc) with a stable id tie-break.
- isPublished is **not** a public filter. Unknown query parameters are rejected.
- List fields: id, slug, title, publishedAt. Body is omitted from list pages.
- Detail fields: id, slug, title, body, publishedAt.
- Body is returned as stored Markdown source. This API does not sanitize or render it.
- Public catalog cache policy applies: CNT-01 does not set Cache-Control: no-store and does not add Redis caching.

CNT-04 may add excerpt, author summary, cover, categories, tags, and public taxonomy routes. Exact paths are an OpenAPI decision in that task. Public taxonomy slugs follow the same kebab-case rules.

## Frontend / Admin parity

Admin Editor preview and storefront Blog renderer must share the same Markdown profile and extensions. Do not ship incompatible parsers. Frontend implementation is outside this repository; this policy is the contract they must follow.

## Media boundary

CNT-04 has **no** Blog→Media FKs yet. CAT-04 owns Media metadata/upload. MED-01 / [ADR 0022](../docs/adr/0022-media-attachment-and-reference-lifecycle.md) owns Blog cover, Author avatar, durable inline-directive registration, Product image, reference-aware delete, and usage inspection. Catalog Category has **no** V1 image. Orphan retention/cleanup is DATA-02.

Aparat remains an external controlled embed and does not create Media.

Do not invent a polymorphic attachment table in a content task that would replace Media rows. Do not persist host-specific URLs on Blog.

## Persistence notes

Repository create is an internal persistence helper for tests and CNT-02 Admin HTTP. CNT-01 exposed no write HTTP.

Application title/body normalization trims with ECMAScript String.trim() (all Unicode whitespace) and measures length with Unicode code points to match PostgreSQL char_length. Database CHECKs trim only ASCII space, tab, LF, and CR as defense in depth against direct SQL writes; repository paths always normalize through domain helpers first.

Public list reads use BlogRepository.listPublished; unrestricted listing is a separate listAll path for Admin. Public detail uses findPublishedBySlug; Admin detail uses findById.

## Task ownership

| Concern                                                            | Task                     |
| ------------------------------------------------------------------ | ------------------------ |
| Core Blog persistence, public list/detail                          | CNT-01 (DONE)            |
| Admin create/edit/publish/unpublish                                | CNT-02 (DONE)            |
| This architecture                                                  | CNT-03 (DONE) / ADR 0021 |
| Markdown contract, directives, taxonomy, excerpt, SEO, Author APIs | CNT-04 (DONE)            |
| Cover/avatar/inline Media FKs, registry, lifecycle                 | MED-01 (DONE; ADR 0022)  |
| Audit events                                                       | AUD-01 / AUD-02          |
| Legacy field inventory and HTML conversion                         | MIG-01 / MIG-02          |
| Comments, revisions, scheduling, Yoast SEO                         | Not approved             |

CNT-04 already shipped excerpt/SEO/author/taxonomy without Media FKs. MED-01 adds cover/avatar/inline registry in one additive Media migration. Do not change body TEXT.

## Legacy evidence / MIG-01 deltas

Human-approved Blog requirements in ADR 0021 are in force even though MIG-01 has not run. MIG-01 may later discover additional legacy fields or HTML bodies; document those as **deltas** against this policy. Do not revert Markdown, Author, taxonomy, excerpt, or SEO because they were absent from CNT-01.

Still **not** approved (do not invent without a new decision):

| Topic                                            | Status                    |
| ------------------------------------------------ | ------------------------- |
| Comments / view counters                         | Absent                    |
| Media gallery (beyond cover + inline directives) | Absent                    |
| Scheduled publishing                             | Absent (isPublished only) |
| Soft-delete / revisions                          | Absent                    |
| Slug redirects on rename                         | Absent                    |
| Canonical/robots/OG duplicates / keywords        | Absent                    |
| BlogTag.isActive                                 | Rejected (no evidence)    |
| Public Author as Admin FK                        | Rejected                  |
