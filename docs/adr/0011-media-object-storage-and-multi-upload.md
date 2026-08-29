# ADR 0011: Media object storage and multi-upload semantics

## Status

Accepted

## Context

EggShip needs a reusable Admin Media Library. Legacy back-office behavior included upload/select/delete of media used by catalog and content features, with one file uploaded at a time. The architecture owner approved improving that UX so Admin can upload multiple files in one workflow.

The API deploys on Liara and must stay stateless: application disk is not canonical storage. CAT-04 must not invent Product/Blog attachment, private-media ACL, or a reconciliation worker.

## Decision

- Persist **metadata only** in PostgreSQL (`Media`). Binary objects live behind a `StorageProvider` port (`put`, `delete`, `exists`, `getPublicUrl`).
- Implement an **S3-compatible** adapter (works with Liara Object Storage) and an **in-memory** adapter for tests and Docker-free local development. Production forbids the in-memory adapter and must not fall back to local disk.
- Generate collision-resistant keys `media/<utc-year>/<utc-month>/<uuid>.<ext>` from detected content type. Never use the client filename as a path.
- Accept JPEG/PNG/WebP after magic-byte detection. Reject SVG and other types until separately approved.
- Treat files in a batch as **independent operations**, not one database transaction. An accepted batch returns HTTP **200** with per-file `uploaded` / `failed` items. Request-level bound failures remain 4xx.
- Bound multipart parsing and internal upload concurrency. Partial success must not depend on the frontend limiting parallelism.
- Upload order: validate → storage put → row create; compensate with best-effort object delete if the row fails. Delete order: object first, then row, so a storage failure remains retryable. Missing-key object delete is success at the S3-compatible adapter. Concurrent delete of the same id is idempotent (HTTP 200).

## Consequences

- Frontend retry is per failed file; successful Media ids remain valid.
- Object storage and PostgreSQL can diverge (orphans or a missing object after a crash). DATA-02 owns cleanup; CAT-04 does not add a worker or invent retention.
- Changing CDN/`STORAGE_PUBLIC_BASE_URL` does not require rewriting Media rows because URLs are derived.
- Future Product/Blog FKs must Restrict against deleting in-use Media; CAT-04 does not add those FKs. Attachment architecture is accepted in [ADR 0022](0022-media-attachment-and-reference-lifecycle.md) (MED-01).
- Live credentialed bucket verification remains opt-in and is not required to complete CAT-04.
