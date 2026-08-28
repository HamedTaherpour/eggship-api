# Media library

Durable policy for EggShip reusable Media. Field-level HTTP contracts belong in OpenAPI; this file records storage, upload, and lifecycle rules that must not drift.

CAT-04 implements the Media domain. Product, Blog, and Category attachment is later work (MED-01) and must not assume a one-to-one relationship. CNT-01 Blog persistence has no Media FK.

## Ownership

| Concern                          | Owner                                             |
| -------------------------------- | ------------------------------------------------- |
| Media metadata rows              | `src/modules/media`                               |
| Object bytes                     | `StorageProvider` in `src/infrastructure/storage` |
| Public URL derivation            | storage provider + `STORAGE_PUBLIC_BASE_URL`      |
| Product/Blog/Category references | future owning modules; FK `ON DELETE RESTRICT`    |

Media is not owned by Products. Other domains may store a media id. Approved deferred-settlement tracking will reference Media for externally received receipt/proof metadata; Settlement owns that relationship and must use `ON DELETE RESTRICT` ([settlement.md](settlement.md)).

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
- Keys are stable after upload.

## Supported types

Launch allowlist, detected from magic bytes (not client `Content-Type` or extension):

- `image/jpeg`
- `image/png`
- `image/webp`

SVG is rejected (active content). GIF is omitted until MIG-01 evidences it. Arbitrary files are rejected.

The stored extension is derived from the detected type.

## Upload bounds (configurable)

Launch defaults:

| Limit                       | Default | Hard maximum |
| --------------------------- | ------: | -----------: |
| Per-file size               |   5 MiB |       20 MiB |
| Files per batch             |      10 |           20 |
| Aggregate batch size        |  25 MiB |      100 MiB |
| Internal upload concurrency |       3 |            8 |

Env: `MEDIA_MAX_FILE_BYTES`, `MEDIA_MAX_FILES_PER_BATCH`, `MEDIA_MAX_BATCH_BYTES`, `MEDIA_UPLOAD_CONCURRENCY`.

Multer hard-caps files/size at the hard maxima so application-level checks cannot be bypassed by a malicious client. Inbound multipart is buffered in memory with a running aggregate cap: reading stops once `HARD_MEDIA_MAX_BATCH_BYTES` (100 MiB) is exceeded, so a `MEDIA_MANAGE` caller cannot force 20 × 20 MiB into process memory. A file between the configured per-file limit and the multer hard cap is a **per-file** `MEDIA_FILE_TOO_LARGE`. Exceeding the multer cap, file count hard cap, missing files, or aggregate batch size is a **request-level** 4xx. Nest converts some multer failures into `HttpException`; the upload filter maps those to the same Media codes and does not echo unexpected field names.

## Multi-upload semantics

`POST /api/v1/admin/media/upload` with multipart field `files` (repeat the field). Single-file upload uses the same endpoint.

Files are independent operations. Object storage and PostgreSQL do not share a transaction.

- Request-level validation failure → 4xx (`MEDIA_NO_FILES`, `MEDIA_TOO_MANY_FILES`, `MEDIA_BATCH_TOO_LARGE`, multer hard-limit mapping).
- Accepted batch, including mixed or all-failed per-file outcomes → **HTTP 200** with `data.items[]` and `data.summary`.

If 8 files succeed and 2 fail, the 8 Media rows and objects remain. Failed items use stable codes so the client can retry only those files.

## Upload failure order

Per file: validate → storage `put` → DB create. If DB create fails, best-effort storage `delete`.

Crashes can still leave an object without a row. That is an **orphan**; cleanup is DATA-02, not a CAT-04 worker.

## Deletion

`DELETE /api/v1/admin/media/:id` (`MEDIA_MANAGE`):

1. Load the row (404 if missing).
2. Delete the object (idempotent missing-key is success at the adapter where the API allows it).
3. Delete the row.

If storage delete fails, the row is kept and the API returns `MEDIA_DELETE_FAILED` so the client can retry. If storage succeeds and the row is already gone (concurrent delete or a retry after the row was removed), the API returns **200** with the previously loaded metadata. If storage succeeds and the row delete then throws, the API returns `MEDIA_DELETE_FAILED`; retry is the recovery path (missing-key object delete is success at the S3-compatible adapter).

No Product/Blog FKs exist yet; the deferred-settlement receipt reference (SET-02, [ADR 0018](../docs/adr/0018-deferred-settlement-lifecycle.md)) is the first approved attachment. `OrderSettlement.receiptMediaId` uses `ON DELETE RESTRICT`, and Media deletion checks this reference **before** storage object deletion. While referenced, deletion returns `MEDIA_REFERENCED` (409) and removes neither object nor row. Settlement proof cannot be detached by deleting the Media row.

## List and detail

Admin only:

- `GET /api/v1/admin/media` — CAT-01 pagination; search on `originalFileName` only; sort allowlist `createdAt`, `originalFileName`, `sizeBytes` (default `createdAt desc`); optional `mimeType`, `createdFrom`, `createdTo`.
- `GET /api/v1/admin/media/:id`

No public Media metadata API. Storefront images are fetched from the object/CDN URL, not streamed by Nest.

## Public URL and visibility

Responses expose a derived `url`, not a persisted host-specific string and not `storageKey`.

Launch assumption: catalog/blog imagery is **public** object content. Private-media ACL and indefinite signed URLs are not implemented. If a bucket is private, a later task must define signed-URL lifetime.

## Permissions

- `MEDIA_READ` — list/detail
- `MEDIA_MANAGE` — upload/delete

Do not role-check in controllers. `USER` receives 403. `WAREHOUSE` currently has `MEDIA_READ` only.

## Duplicates

Uploading the same bytes twice creates two Media records. No content hash or perceptual deduplication.

## Observability and audit

Log aggregate batch counts (`media.batch.completed`) and delete outcomes. Log unexpected per-file storage/persistence failures at error with stable codes (no bytes, no raw filenames, no provider internals). Do not log file bytes or raw client filenames.

Upload and delete are auditable Admin candidates for AUD-01. Do not write fake AuditLog rows.

## Image dimensions

`width` / `height` are persisted when JPEG/PNG/WebP headers can be parsed without a heavyweight image pipeline. Missing dimensions do not reject an otherwise valid image.

## Follow-ups

- Product/Blog/Category attachment (not CAT-04; CNT-01 Blog has no Media FK)
- Orphan object reconciliation, failed-delete retry, unused-Media policy (DATA-02; no retention periods invented here)
- Live production-bucket verification (DEP-02 / credentials)
- Historical-reference rules when content starts pointing at Media (CNT/PRC)
- Additional Product/Blog/Category attachment workflows; deferred-settlement receipt reference is implemented by SET-02 with one current image and `ON DELETE RESTRICT`
