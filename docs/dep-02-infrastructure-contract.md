# DEP-02: Liara infrastructure and secrets contract

## Status and authority

This document is the DEP-02 provisioning/configuration contract for EggShip.
It records the provider facts verified by Human + ChatGPT and the repository
configuration that a human may use during a later, separately authorized
provisioning activity. It does not provision resources, deploy releases, run
migrations, choose plans or sizes, or establish capacity, backup-retention,
RPO/RTO, replica, or worker-concurrency values.

ADR 0025 remains the runtime architecture authority. Provider-issued
connection details from the actual Liara resources are authoritative over every
example in this document.

## Resource matrix

Each row is a separate Liara resource or configuration boundary. Equivalent
staging resources are required; equivalence does not mean sharing.

| Tier       | API / future Worker                                                                                                                                     | PostgreSQL                                                                                                         | Redis                                                                                                              | Object Storage                                                                         | Configuration / secrets                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Production | Liara application/processes attached to the production private network; one immutable release artifact                                                  | Dedicated production DBaaS resource in the production private-network boundary; public network disabled by default | Dedicated production DBaaS resource in the production private-network boundary; public network disabled by default | Dedicated private bucket using the official Liara S3-compatible HTTPS endpoint         | Liara-managed production environment configuration and bucket-scoped credentials |
| Staging    | Separate Liara application/processes attached to a separate staging private network; production artifact path may be exercised without sharing services | Dedicated staging DBaaS resource in the staging private-network boundary; public network disabled by default       | Dedicated staging DBaaS resource in the staging private-network boundary; public network disabled by default       | Dedicated private staging bucket using the official Liara S3-compatible HTTPS endpoint | Liara-managed staging environment configuration and staging-only credentials     |

No plan, size, pool budget, replica count, concurrency value, backup
retention, or recovery objective is selected by this contract.

## Private network / public access policy

- Production API and future Worker attach to the production private network.
- Production PostgreSQL and Redis are in the same production private-network
  boundary.
- Staging API/future Worker, PostgreSQL, and Redis use a completely separate
  staging private network and separate resources.
- PostgreSQL public-network access is disabled by default in both tiers; DEP-02
  approves no public-DB exception.
- Redis public-network access is disabled by default in both tiers; DEP-02
  approves no public-Redis exception.
- A public-network exception, if ever needed for an operational procedure,
  requires a separately recorded human approval, narrow scope, and removal
  after the procedure. It is not part of the application contract.
- Object Storage is not assumed to be reachable through the private network.
  The application uses the official Liara S3-compatible HTTPS endpoint.

## PostgreSQL configuration contract

`DATABASE_URL` is the sole application connection input. It must be the
provider-supported PostgreSQL connection URL copied from the provisioned,
environment-matched Liara DBaaS resource. It must not be composed by guessing a
host, port, database name, username, password, certificate, or query option.

The same tier-specific URL is supplied to API and any database-using Worker.
Development and integration use their existing dedicated `DATABASE_URL` /
`TEST_DATABASE_URL` policies; neither may use a staging or production URL.

The existing validated optional pool settings remain configuration inputs:
`DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT_MS`, and
`DATABASE_IDLE_TIMEOUT_MS`. DEP-02 does not choose their production values or
perform pool/capacity planning.

PostgreSQL is authoritative for durable state. Local disk and Redis are never
fallback authorities. Migration execution remains the single explicit
`prisma migrate deploy` release step owned by later deployment work; DEP-02
does not run it.

## Redis configuration contract

`REDIS_URL` is the sole application Redis connection input. For production and
staging it must be copied from the matching Liara DBaaS resource and use the
provider-supported connection form exactly as issued. It must not be rebuilt
from guessed TLS, certificate, hostname, port, or database-index values.

The environment-scoped Redis is shared by API Redis capabilities, BullMQ
producers, and approved Workers as defined by ADR 0025. Redis remains
ephemeral: it is not authoritative for orders, inventory, identity, sessions,
or other durable facts.

`REDIS_URL` must never point development, test, or integration work at
production Redis. The existing `TEST_REDIS_URL` guardrails remain in force.

## Object Storage configuration contract

Production and staging use separate private Liara Object Storage buckets. The
application connects through Liara's official S3-compatible endpoint over
HTTPS. DEP-02 does not assume or require a private-network Object Storage
endpoint.

The bucket and access key are environment-scoped. The access key is
bucket-scoped and its secret is stored only in the matching Liara-managed
environment configuration. `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, and
`STORAGE_REGION` are copied from the actual provider resource/configuration;
the region is not guessed from an example.

The existing runtime names are the canonical mapping:

| Variable                                    | Contract                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`                          | `s3` in production; memory remains development/test only                                                 |
| `STORAGE_ENDPOINT`                          | Official Liara S3-compatible HTTPS endpoint                                                              |
| `STORAGE_REGION`                            | Provider-issued S3 region value                                                                          |
| `STORAGE_BUCKET`                            | Private, tier-specific bucket                                                                            |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Bucket-scoped, tier-specific credential pair                                                             |
| `STORAGE_PUBLIC_BASE_URL`                   | URL derivation input only; it does not make a private bucket public and must contain no credentials      |
| `STORAGE_FORCE_PATH_STYLE`                  | Use only as supported by the actual endpoint/client configuration; no provider behavior is inferred here |

Presigned access is required wherever a client must read a private object.
The current `StorageProvider` exposes only `getPublicUrl`, not presigning, so
the current Media response/access path is not production-compatible with a
private bucket. DEP-02 records this as an explicit follow-up; no public bucket
or unauthenticated URL workaround is approved.

Object bytes are canonical in Object Storage, not on application-local disk.
Media rows retain storage keys/metadata according to the existing Media
policy; consumer relationships retain Media IDs, never provider URLs.

## Environment / secret mapping

| Concern                 | Production / staging source                   | Repository input                                                                          | Ownership                                                                        |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| PostgreSQL connectivity | Matching private DBaaS resource               | `DATABASE_URL`                                                                            | Liara environment configuration; application consumes, does not log or derive it |
| Redis connectivity      | Matching private DBaaS resource               | `REDIS_URL`                                                                               | Liara environment configuration; application consumes, does not log or derive it |
| S3 connectivity         | Matching private bucket and official endpoint | `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`                                    | Liara environment configuration; bucket/resource owner controls values           |
| S3 credential           | Bucket-scoped tier credential                 | `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`                                                | Liara-managed secret; infrastructure owner rotates                               |
| Application secrets     | Tier-specific Liara secrets                   | `JWT_ACCESS_SECRET`, `OTP_HASH_SECRET`, `CSRF_SECRET`, and provider secrets as applicable | Liara-managed secrets; application validates and never emits values              |
| Release identity        | Immutable build/release metadata              | `APP_VERSION`, `GIT_SHA`                                                                  | Release process injects actual values; not hand-maintained secret config         |
| Media URL derivation    | Tier-specific non-secret URL base, if used    | `STORAGE_PUBLIC_BASE_URL`                                                                 | Application config only; not an access-control grant                             |

Secrets are never committed, placed in `.env.example`, included in images,
printed by provisioning scripts, or logged. Rotation is a Liara/infrastructure
operation: create or issue the replacement credential using supported provider
controls, update only the matching tier, validate with a bounded smoke check,
then revoke the old credential when the provider supports that sequence. No
cross-tier credential reuse is permitted.

## Staging / production isolation

Isolation is enforced by separate applications/configuration, private network,
PostgreSQL resource, Redis resource, bucket, and credentials. A staging
deployment must not receive production URLs, bucket names, access keys, or
secrets. A production deployment must not receive development/test/staging
values. Integration-test variables remain dedicated `TEST_*` inputs and are
never substitutes for deployment-tier configuration.

## Safe provisioning procedure

A human infrastructure owner performs and records each step; none is executed
by DEP-02:

1. Create or confirm the separate staging and production Liara private
   networks.
2. Create one environment-matched API application boundary and reserve the
   future Worker process/application boundary without deploying the empty
   Worker before its approved processor exists.
3. Provision separate PostgreSQL and Redis DBaaS resources in the matching
   private-network boundary. Disable each resource's public network by
   default.
4. Provision separate private Object Storage buckets and a bucket-scoped
   access key for each tier. Record the official HTTPS S3 endpoint and
   provider-issued region without altering them.
5. Copy provider-issued PostgreSQL and Redis connection forms verbatim into
   the matching Liara-managed environment configuration. Do not add guessed
   TLS query parameters or alternate URL forms.
6. Add the tier-specific application secrets and S3 credential values through
   Liara-managed configuration only. Keep values out of tickets, shell
   history, logs, repository files, and release artifacts.
7. Verify configuration metadata without printing secrets: tier identity,
   masked host/protocol metadata, private-network attachment, public-network
   disabled state, bucket privacy, and credential scope.
8. Stop before deployment if any value is missing, provider-issued TLS details
   cannot be consumed by the current runtime, or private object reads require
   presigning that the current application does not yet implement.
9. Hand the resulting evidence to DEP-03/DEP-04 owners. DEP-02 does not deploy,
   migrate, cut over, or run a production smoke test.

## TLS / connectivity policy

Provider-issued connection details are authoritative. This repository must not
invent `sslmode`, CA material, `rediss`, certificate, hostname, port, database
index, or any other connectivity setting. `DATABASE_URL` and `REDIS_URL` must
consume the provider-supported connection form as issued. If provisioning
evidence shows that the current client needs additional TLS configuration,
that is a later evidence-driven implementation/change; it is not guessed in
DEP-02.

## Review handoff

DEP-02 is documentation/configuration-contract work only. Authentication,
authorization, transaction/concurrency, API/OpenAPI, and schema/migration
changes are not applicable to this task. Security, logging, local-disk
authority, environment isolation, and configuration drift are reviewed here.

The private-bucket presign mismatch is an application follow-up and prevents a
claim that the current deployed Media read path is production-ready. It does
not authorize implementing DEP-03 readiness/migrations/draining, DEP-05
backup/restore, or DEP-06 rollback.
