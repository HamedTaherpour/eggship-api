# ADR 0021: Blog content architecture

## Status

Accepted

## Context

CNT-01 and CNT-02 delivered a minimal Blog core: title, slug, body, isPublished, publishedAt, createdAt, and updatedAt. Body was stored as opaque markup (HTML or Markdown). The API does not sanitize or render it. There is no Media FK, public Author, taxonomy, excerpt, or SEO metadata.

Human-approved product requirements now extend Blog before more schema is added. MIG-01 has not yet inventoried legacy Blog fields. Absence from that inventory must not erase these approved requirements; later legacy discoveries are migration deltas.

CNT-01/CNT-02 remain closed. MED-01 still owns generic Media attachment, historical-reference integrity, and orphan cleanup. AUD-01 still owns AuditLog. No existing READY task can safely own Markdown authoring, controlled embeds, taxonomy, excerpt, SEO metadata, and public Author without silently expanding a DONE task or mixing Media-library work into content.

This ADR records the accepted V1 Blog content architecture. It does not change Prisma, APIs, or runtime code.

## Decision

### 1. Markdown source contract

Blog.body is **Markdown source**. The backend stores that source and does not convert it to final HTML. Existing TEXT storage remains compatible; CNT-04 must not change the column type.

CNT-01's "HTML or Markdown" opacity is superseded for **new authoring**. Stored body is Markdown plus EggShip-controlled directives. The API still does not emit rendered HTML.

TanStack Markdown is the current preferred **frontend** renderer candidate. It is not a Nest/backend dependency unless a later implementation task proves a shared parser is required for Media-reference extraction. Do not add it in this architecture change.

### 2. Renderer and security contract

Rendering pipeline:

Markdown source -> parser/AST -> allowlisted renderers/components

- Standard Markdown (CommonMark emphasis, lists, headings, links, quotes, code): allowed
- EggShip-controlled directives: allowed
- Raw executable HTML (script tags, arbitrary tags): forbidden
- Arbitrary iframe/script snippets: forbidden
- MDX / JSX execution: forbidden

Storefront and Admin preview must use **component-based rendering**, not trusted HTML strings from stored body. If TanStack Markdown is selected, keep allowHtml disabled unless a later explicit security review approves otherwise. A Markdown library is not assumed to sanitize extension-generated HTML.

Link href values must use allowlisted schemes (https, and mailto only if CNT-04 keeps that CommonMark default). Reject javascript, data, and other unsafe schemes.

Standard Markdown images are **not** the authoritative inline-image model. Renderers must not fetch or display arbitrary remote image URLs (tracking pixels, host exfiltration). Inline images use the Media directive only.

### 3. Custom directive model

Non-standard content uses controlled directives, not raw HTML. Conceptual forms (exact grammar is CNT-04):

    ::media[id="MEDIA_UUID" alt="..." caption="..."]
    ::aparat[id="ivejp35"]

Unknown directives fail closed: CNT-04 must either reject them on save or leave them unrendered; they must never become raw HTML. Authors must not paste executable embed snippets and expect them to run.

### 4. Inline Blog images

Authoritative identity is the EggShip Media UUID inside the directive, not a storage/CDN URL. The renderer resolves Media through Media-owned public URL derivation (ADR 0011).

Save/update must parse Markdown with an AST/parser when available and collect Media IDs from media directives. Regex-only extraction is not the long-term authority.

MED-01 owns the durable reference relationship used for delete restriction, resolution, orphan cleanup, and historical integrity. Inline Media must not be treated as deletion-safe until that registry exists.

### 5. Cover image

Blog supports **one** cover image: Blog.coverMediaId -> Media, not a persisted storage URL. MED-01 defines FK Restrict, delete restriction (MEDIA_REFERENCED), historical/reference integrity, and orphan coordination with DATA-02. Cover image may serve as social/OG image in the frontend unless a later SEO task adds a separate override.

### 6. Aparat embeds

Authors paste an Aparat URL or video identifier. The editor converts it to an aparat directive. The frontend renderer builds the approved Aparat iframe. Only allowlisted Aparat host/embed behavior is supported (aparat.com / www.aparat.com and the documented embed path). Raw Aparat scripts, AMP snippets, or arbitrary iframe HTML are not stored as executable content.

CNT-04 must validate the identifier (bounded alphanumeric) and must not proxy or server-side-fetch Aparat pages as an HTML rewrite step.

### 7. Blog categories

Content-owned BlogCategory (id, name, slug, description, isActive, timestamps). Description is plain text. Many-to-many with Blog. No parent/child hierarchy in V1. This is **not** catalog Category (src/modules/categories).

Public lists return active categories only. Deactivation hides a category from public taxonomy indexes; it does not unpublish assigned posts. Assigning an inactive category on write is rejected. Unique slug, same kebab-case rules as Blog (caller-provided, 1-120).

### 8. Blog tags

Content-owned BlogTag (id, name, slug, description, timestamps). Description is plain text. Many-to-many with Blog.

**No isActive.** Catalog Category uses isActive because sellable Products remain assigned while public lists hide inactive rows. No equivalent Blog-tag product requirement exists; adding isActive only for symmetry is rejected. Unused tags remain listable; delete is ON DELETE RESTRICT while Blog rows reference them.

### 9. Excerpt

Dedicated editorial excerpt. Bounded plain text (not Markdown). Not derived from the first N characters of body as the stored value. Separate from seoDescription.

Bounds: Unicode trim (same as title/body); max **320** code points (aligned with a short teaser / meta-description fallback, distinct from title 200). Empty after trim is stored as null. Optional on drafts; CNT-04 must not invent an automatic body substring.

### 10. SEO metadata

Minimal V1:

- seoTitle optional, plain text, max **200** code points
- seoDescription optional, plain text, max **320** code points

Fallbacks (frontend/document head; backend may expose both raw and resolved values):

- page title: seoTitle ?? title
- meta description: seoDescription ?? excerpt

Not in V1: canonical URL override, per-post robots, Open Graph title/description duplicates, Twitter-specific fields, keyword fields. Canonical URL is derived from route + slug.

### 11. Public Author

BlogAuthor is a public-facing editorial persona, **not** an Admin FK: id, name, slug, optional bio, optional avatarMediaId, isActive, timestamps.

Blog.authorId references BlogAuthor. The Admin who edits or publishes is not the public Author. Avatar Media lifecycle is MED-01 (ON DELETE RESTRICT).

Published posts require an active BlogAuthor. Drafts may omit authorId until publish. Deactivating an author hides them from public author indexes and prevents new assignment; it does **not** unpublish existing posts. Article responses continue to read the live author row (name changes apply immediately; this is not an Order-style snapshot).

### 12. Editorial provenance

Public Author is not AuditLog and is not Admin identity.

Do **not** add createdByAdminId / updatedByAdminId / publishedByAdminId on Blog in CNT-04. CNT-02 already records create/update/publish/unpublish as structured-log audit candidates. AUD-01/AUD-02 own the append-only event contract. Denormalized actor columns on Blog, if ever needed for Admin UX, require a future dedicated content-provenance task — not a silent AUD-01 schema add, and not confusion with BlogAuthor.

### 13. Publication lifecycle

Unchanged from CNT-01/CNT-02:

- Public visibility is isPublished = true only
- publishedAt is an authoritative UTC instant, not a schedule gate
- First publish and republish after unpublish set server now
- Publish replay preserves publishedAt
- Unpublish preserves previous publishedAt
- No scheduled publishing (scheduledAt, cron, queue job, scheduled state)

### 14. Frontend / Admin parity

Admin editor preview and storefront Blog renderer must share the same Markdown profile and directive set. Divergent libraries or HTML-vs-component pipelines are not acceptable. Exact package choice is a frontend implementation decision; this API documents the profile. Frontend work is not in CNT-04.

### 15. MED-01 boundary

- Media bytes, metadata, upload/delete library: CAT-04 / ADR 0011
- Blog.coverMediaId, BlogAuthor.avatarMediaId FKs, Restrict, MEDIA_REFERENCED: MED-01 (content may persist the columns in a coordinated migration)
- Durable inline Media IDs extracted from media directives: MED-01
- Product and catalog Category attachments: MED-01
- Orphan object retention periods: DATA-02
- Markdown grammar, Aparat, taxonomy, excerpt, SEO, Author APIs: CNT-04

### 16. MIG-01 boundary

These requirements are approved product architecture. MIG-01 must not drop them because they were absent from CNT-01. If legacy evidence later shows extra fields (comments, gallery, slug redirects, HTML bodies, scheduled publish), record **deltas** against this ADR rather than reverting it. Existing body rows are not rewritten by this decision; if MIG-01 finds legacy HTML, conversion is a later migration task, not silent HTML execution in the renderer.

### 17. Implementation ownership

- CNT-03 (this ADR + durable instructions/content.md): architecture only.
- CNT-04: content model implementation (schema/APIs for excerpt, SEO, Author, categories, tags, Markdown/directive contract).
- MED-01: Blog/Product/catalog Category Media references and lifecycle.
- AUD-01 / AUD-02: mutation event trail.
- MIG-01 / MIG-02: legacy inventory and any HTML-to-Markdown data conversion.

Prefer **one additive migration** for excerpt, seoTitle, seoDescription, authorId, coverMediaId, categories, and tags when CNT-04 and the Blog slice of MED-01 land together. A CNT-04-first additive migration without Media FKs is allowed if MED-01 is not ready; a second additive Media migration then follows. Do not emit a sequence of one-column migrations.

### Alternatives considered

1. Keep opaque HTML-or-Markdown body (rejected: XSS and embed requirements need a single authoring contract).
2. MDX / stored iframe HTML for Aparat (rejected: executable content in the CMS).
3. Persist CDN URLs on Blog (rejected: host/URL churn; ADR 0011 derives URLs).
4. Reuse catalog Category for Blog (rejected: different lifecycle, slug, and public contract).
5. BlogTag.isActive for symmetry (rejected: no product evidence).
6. Public Author as Admin FK (rejected: editorial persona is not operator identity).
7. Actor columns on Blog now (rejected: AUD-01 owns events; CNT-02 already logs candidates).
8. Auto-excerpt from Markdown (rejected: excerpt is editorial and distinct from SEO description).
9. Yoast-style SEO model (rejected: not approved).
10. Scheduled publishing / revision tables (rejected: out of current scope).

## Consequences

- Storefront XSS prevention is a renderer obligation under this profile, not a backend HTML sanitizer of stored body.
- Inline images are unsafe to delete-protect until MED-01 registers directive Media IDs.
- Public list/detail contracts will grow in CNT-04 (excerpt, author, taxonomy, cover). CNT-01 field sets remain until that task.
- WAREHOUSE/ORDER_OPS still lack CONTENT_* grants; taxonomy and Author admin stay on CONTENT_READ / CONTENT_MANAGE unless MIG-01 evidences finer permissions.
