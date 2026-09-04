# Media library

Durable policy for EggShip reusable Media. Field-level HTTP contracts belong in OpenAPI; this file records storage, upload, attachment, and lifecycle rules that must not drift.

CAT-04 / [ADR 0011](../docs/adr/0011-media-object-storage-and-multi-upload.md) implements the Media library foundation. Attachment, reference integrity, and usage inspection are owned by MED-01 under [ADR 0022](../docs/adr/0022-media-attachment-and-reference-lifecycle.md). Blog Markdown direction remains [ADR 0021](../docs/adr/0021-blog-content-architecture.md) / [content.md](content.md). Orphan retention and cleanup belong to DATA-02 — not MED-01.

## Ownership

| Concern                                                            | Owner                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| Media metadata rows                                                | `src/modules/media`                                    |
| Object bytes                                                       | `StorageProvider` in `src/infrastructure/storage`      |
| Public URL derivation                                              | storage provider + `STORAGE_PUBLIC_BASE_URL`           |
| Product image, Blog cover/avatar/inline registry, usage inspection | MED-01 (ADR 0022)                                      |
| Settlement receipt reference                                       | Settlements (SET-02); Media delete must still Restrict |

Media is not owned by Products or Blogs. Other domains store Media ids. Catalog Category has **no** V1 image.

## Storage abstraction

- Canonical storage is object storage, not the application filesystem.
- Application code must not import an S3/Liara SDK. Use `StorageProvider`: `put`, `delete`, `exists`, `getPublicUrl`.
- Adapters: in-memory (development/test only) and S3-compatible (production, including Liara Object Storage).
- `STORAGE_PROVIDER=memory` is forbidden when `NODE_ENV=production`. Production must fail closed if S3-compatible configuration is missing.
- Docker/MinIO is not required for local development.

## Object keys

Server-generated only:

`media/<utc-year>/<utc-month>/<uuid>.<jpg|png|webp>`

- Do not use the client filename as a path.
- Do not encode PII into keys.
- Keys are stable after upload (immutable storage identity).

## Supported types

Launch allowlist, detected from magic bytes (not client `Content-Type` or extension):

- `image/jpeg`
- `image/png`
- `image/webp`

SVG is rejected (active content). GIF is omitted until MIG-01 evidences it. PDF, documents, uploaded video, and arbitrary files are rejected. Aparat is an external Blog embed and does **not** create Media.

The stored extension is derived from the detected type.

## Upload bounds (configurable)

Launch defaults (preserved; do not invent new caps without operational cause):

| Limit                       | Default | Hard maximum |
| --------------------------- | ------: | -----------: |
| Per-file size               |   5 MiB |       20 MiB |
| Files per batch             |      10 |           20 |
| Aggregate batch size        |  25 MiB |      100 MiB |
| Internal upload concurrency |       3 |            8 |

Env: `MEDIA_MAX_FILE_BYTES`, `MEDIA_MAX_FILES_PER_BATCH`, `MEDIA_MAX_BATCH_BYTES`, `MEDIA_UPLOAD_CONCURRENCY`.

Multer hard-caps files/size at the hard maxima so application-level checks cannot be bypassed by a malicious client. Inbound multipart is buffered in memory with a running aggregate cap: reading stops once `HARD_MEDIA_MAX_BATCH_BYTES` (100 MiB) is exceeded, so a `MEDIA_MANAGE` caller cannot force 20 × 20 MiB into process memory. A file between the configured per-file limit and the multer hard cap is a **per-file** `MEDIA_FILE_TOO_LARGE`. Exceeding the multer cap, file count hard cap, missing files, or aggregate batch size is a **request-level** 4xx. Nest converts some multer failures into `HttpException`; the upload filter maps those to the same Media codes and does not echo unexpected field names.

No backend image resize/transcode/thumbnail/Sharp/WebP conversion pipeline. Admin/frontend prepares appropriately sized images; storefront may use framework image optimization.

## Multi-upload semantics

`POST /api/v1/admin/media/upload` with multipart field `files` (repeat the field). Single-file upload uses the same endpoint.

Files are independent operations. Object storage and PostgreSQL do not share a transaction.

- Request-level validation failure → 4xx (`MEDIA_NO_FILES`, `MEDIA_TOO_MANY_FILES`, `MEDIA_BATCH_TOO_LARGE`, multer hard-limit mapping).
- Accepted batch, including mixed or all-failed per-file outcomes → **HTTP 200** with `data.items[]` and `data.summary`.

If 8 files succeed and 2 fail, the 8 Media rows and objects remain. Failed items use stable codes so the client can retry only those files.

## Upload failure order

Per file: validate → storage `put` → DB create. If DB create fails, best-effort storage `delete`.

Crashes can still leave an object without a row. That is a **storage orphan**; cleanup is DATA-02, not a Media CRUD worker. Do not introduce BullMQ solely for basic Media CRUD.

## Approved V1 consumers

| Consumer         | Capability                 | Relationship                                                      |
| ---------------- | -------------------------- | ----------------------------------------------------------------- |
| Product          | Exactly one optional image | `Product.imageMediaId` → Media                                    |
| Blog             | Optional cover             | `Blog.coverMediaId` → Media                                       |
| Blog             | Inline images              | Durable `BlogInlineMedia` (or equivalent) registry from `::media` |
| BlogAuthor       | Optional avatar            | `BlogAuthor.avatarMediaId` → Media                                |
| OrderSettlement  | One current receipt        | `receiptMediaId` (SET-02)                                         |
| catalog Category | None                       | No image                                                          |

Shared library: the same Media may be referenced from multiple places. Unreferenced Media (uploaded for later use, or left after replace/remove) is valid. Do not auto-delete when reference count hits zero.

Consumers persist Media UUIDs only — never CDN/public URLs as relationship identity. `storageKey` is internal. `originalFileName` is Admin metadata only (not unique).

Media owns technical file metadata. Global Media `alt`/`caption` are not authoritative; inline Blog alt/caption live in the Markdown directive usage context.

### Product / cover / avatar

- Nullable FKs with `ON DELETE RESTRICT`.
- Replace changes the reference only; previous Media is not deleted.
- Product deactivation/deletion and Author deactivation must not delete Media.
- Do not use `ON DELETE SET NULL` to auto-detach on Media delete.

### Inline Blog registry

- On Blog create/update, discover Media IDs with the approved CNT-04 token/directive model (not regex-as-authority).
- Persist distinct `(blogId, mediaId)` rows — no duplicate ownership rows for repeated directives; no body duplication in the registry.
- Removing a directive removes the registry row only.
- Missing/unusable Media IDs fail the Blog save with `MEDIA_NOT_FOUND` (do not silently strip).

### Reference validation

Assigning any consumer reference must verify Media exists and is a supported image, atomically with the PostgreSQL write. No dangling DB references.

## Deletion

`DELETE /api/v1/admin/media/:id` (`MEDIA_MANAGE`):

1. Load and lock the Media row (`FOR UPDATE`) (404 if missing).
2. Determine whether any durable reference exists (Product image, Blog cover, BlogAuthor avatar, Blog inline registry, Settlement receipt).
3. If referenced → **409 `MEDIA_REFERENCED`**; remove neither object nor row. Do not cascade-delete or auto-detach consumers.
4. If unreferenced → delete the object (idempotent missing-key is success at the adapter where the API allows it), then delete the row.

If storage delete fails, the row is kept and the API returns `MEDIA_DELETE_FAILED` so the client can retry. If storage succeeds and the row is already gone (concurrent delete or a retry after the row was removed), the API returns **200** with the previously loaded metadata. If storage succeeds and the row delete then throws, the API returns `MEDIA_DELETE_FAILED`; retry is the recovery path (missing-key object delete is success at the S3-compatible adapter).

## Replace semantics

Replacing Product image, Blog cover, Author avatar, or Settlement receipt (while OPEN) only updates the reference. The previous Media remains in the library and may become unreferenced; it is not immediately deleted.

## Orphans and missing objects

Unreferenced Media is valid. Immediate orphan deletion is out of MED-01. DATA-02 owns cleanup with a conservative retention/grace policy — do not invent durations here.

A DB row may exist while the storage object is missing. Do not silently delete references. Surface unavailable/broken Media for Admin diagnostics; full reconciliation is DATA-02 / later, not MED-01.

## Concurrency

PostgreSQL transactions, row locks, and FKs are authority. Do not use Redis locks for Media attach/delete.

- Media delete holds Media `FOR UPDATE` before reference checks and storage/row deletion.
- Attach/replace locks the consumer aggregate first, then Media id(s) `FOR UPDATE` (sorted when multiple) before writing FKs/registry.
- Blog writes extend CNT-04 lock order with Media: `Blog → BlogAuthor → BlogCategory → BlogTag → Media` (sorted Media UUIDs). Product image: `Product → Media`. Avatar-only: `BlogAuthor → Media`.
- Settlement receipt attach must serialize with Media delete (Media lock or equivalent) so a successful delete cannot race a new durable reference into a dangling relationship.

Details: [ADR 0022](../docs/adr/0022-media-attachment-and-reference-lifecycle.md).

## List, detail, and usage inspection

Admin only:

- `GET /api/v1/admin/media` — CAT-01 pagination; search on `originalFileName` only; sort allowlist `createdAt`, `originalFileName`, `sizeBytes` (default `createdAt desc`); optional `mimeType`, `createdFrom`, `createdTo`.
- `GET /api/v1/admin/media/:id`
- MED-01: usage inspection so Admin can see where a Media id is referenced (Product, Blog cover, BlogAuthor avatar, Blog inline, Settlement receipt). Exact path is an OpenAPI decision in MED-01.

No public Media metadata API. Storefront images are fetched from the object/CDN URL, not streamed by Nest.

Out of V1 Media Library UX: folders, collections, tagging, DAM taxonomy, bulk transforms, versioning.

## Public URL and visibility

Responses expose a derived `url`, not a persisted host-specific string and not `storageKey`.

Production/staging Object Storage buckets are **private** under the DEP-02 contract. `STORAGE_PUBLIC_BASE_URL` is only a derived URL-base input and is not an access grant. Private-object reads require presigned access where the consumer needs a URL. The current provider port only exposes `getPublicUrl`; implementing presigned access and updating any affected response/read path is an explicit follow-up before production Media reads. Changing the endpoint or URL base must not require rewriting consumer relationships.

## Permissions

- `MEDIA_READ` — list/detail/usage inspection
- `MEDIA_MANAGE` — upload/delete

Do not role-check in controllers. `USER` receives 403. `WAREHOUSE` currently has `MEDIA_READ` only.

## Duplicates

Uploading the same bytes twice creates two Media records. No content hash or perceptual deduplication.

## Observability and audit

Log aggregate batch counts (`media.batch.completed`) and delete outcomes. Log unexpected per-file storage/persistence failures at error with stable codes (no bytes, no raw filenames, no provider internals). Do not log file bytes or raw client filenames.

Media deletion is integrated with AUD-02 as `media.deleted`: the authenticated
Admin actor, Media entity UUID, and null metadata are appended in the same
PostgreSQL transaction as the durable Media-row deletion. The event proves the
database transition only; it does not prove distributed atomicity or that
object bytes are definitely gone. Upload is not audited, and failed or
referenced delete attempts remain operational logs only.

## Image dimensions

`width` / `height` are persisted when JPEG/PNG/WebP headers can be parsed without a heavyweight image pipeline. Missing dimensions do not reject an otherwise valid image.

## Follow-ups

- MED-01 implementation of ADR 0022 (attachment FKs, inline registry, reference-aware delete expansion, usage inspection)
- Orphan object reconciliation, failed-delete retry, unused-Media retention (DATA-02; no retention periods invented here)
- Live production-bucket verification (DEP-02 / credentials)
