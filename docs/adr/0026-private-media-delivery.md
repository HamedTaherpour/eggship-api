# ADR 0026 — Private Media delivery

Status: Accepted MED-02 implementation architecture; staging proof pending

ADR 0022 remains authoritative for attachment ownership and lifecycle. This ADR
defines private-object delivery under DEP-02's private-bucket contract.

Media has an immutable `PUBLIC` or `ADMIN_ONLY` access class. Product images,
Blog covers/inline media, and BlogAuthor avatars are PUBLIC; Settlement receipts
are ADMIN_ONLY. A reference change never mutates the class.

Public consumers expose `/api/v1/media/:mediaId/content`, which resolves only
PUBLIC Media, checks availability, and returns a 302 to a short-lived
provider-signed GET URL. Unknown and ADMIN_ONLY ids are indistinguishable 404s.
The redirect is `no-store` and `no-referrer`; bytes are never proxied.

ADMIN_ONLY reads are settlement-owned: `SETTLEMENT_READ` is required, the exact
settlement receipt relationship is checked, and a short-lived signed URL is
returned. There is no generic sensitive-media signing endpoint. Sensitive
responses are `no-store` and URLs are never logged.

`StorageProvider.createSignedReadUrl(storageKey, { purpose, expiresInSeconds })`
owns signing. SDK types remain in infrastructure, keys are validated, provider
failures are sanitized, and signed URLs are neither persisted nor logged.

TTL policy is typed and validated: PUBLIC defaults to 3600 seconds, bounded
300–86400; ADMIN defaults to 300 seconds, bounded 60–900.

The migration classifies settlement references as ADMIN_ONLY and public
references as PUBLIC. Mixed references and unreferenced legacy rows fail closed
and require operator classification; intent is never guessed. Real Liara
private-bucket evidence is required before MED-02 is DONE.
