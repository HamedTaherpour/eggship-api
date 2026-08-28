# EggShip API

EggShip API is the standalone backend for EggShip. This repository currently provides the production-oriented engineering foundation only; business capabilities live in future, explicitly scoped modules.

## Stack

- Node.js 24 LTS, NestJS, strict TypeScript, and provider-independent Pino logging
- PostgreSQL and Prisma ORM
- Optional Redis and BullMQ asynchronous infrastructure
- pnpm
- Jest and Nest testing tools
- ESLint, Prettier, Husky, lint-staged, and commitlint
- Optional Docker Compose for contributors who already use containers; GitHub Actions for CI

## Requirements

- Node.js 24 LTS
- pnpm 10 or newer (Corepack is recommended)
- Dedicated **development** PostgreSQL when exercising persistence (remote preferred; native local install optional)
- Isolated **development** Redis only when exercising Redis-backed capabilities
- Docker is **not** required for normal local development

## Developer quickstart

```powershell
# 1–2. Node 24 + repository pnpm (Corepack recommended)
corepack enable

# 3. Install dependencies
pnpm install

# 4. Prepare local .env (Windows PowerShell)
Copy-Item .env.example .env
# POSIX: cp .env.example .env
# Fill required values. Never commit .env or production credentials.

# 5–6. Point DATABASE_URL at dedicated development PostgreSQL when needed.
#     Leave REDIS_URL blank unless you need Redis; if set, use development Redis only.

# 7. Generate Prisma Client
pnpm prisma:generate

# 8. Start NestJS
pnpm start:dev
```

Optional sanity check (does not require Docker or live infrastructure contact):

```bash
pnpm env:check
```

The application validates its environment before startup and listens on `0.0.0.0:$PORT`. The only initial route is `GET /api/v1/health`.

Intended development topology:

```text
NestJS API (local pnpm)
        │
        ├── remote DEVELOPMENT PostgreSQL when needed
        └── remote DEVELOPMENT Redis when needed (optional)
```

See [instructions/environment.md](instructions/environment.md) for the full environment model, variable reference, migration workflow, seed policy, and Liara boundary.

## Environment

| Variable          | Required | Secret | Purpose                                                                   |
| ----------------- | -------- | ------ | ------------------------------------------------------------------------- |
| `NODE_ENV`        | Yes      | No     | `development`, `test`, or `production` (not `staging`)                    |
| `PORT`            | Yes      | No     | HTTP port from 1 to 65535                                                 |
| `DATABASE_URL`    | Yes      | Yes    | PostgreSQL connection URL                                                 |
| `APP_VERSION`     | Yes      | No     | Deployed semantic version (SemVer; not a competing hand-edited authority) |
| `GIT_SHA`         | Yes      | No     | Deployed source revision (inject at build; local may use `local`)         |
| `REDIS_URL`       | No       | Yes    | `redis://` or TLS `rediss://` URL; omit to disable Redis                  |
| `OPENAPI_ENABLED` | No       | No     | `true`/`false` override for Swagger UI and OpenAPI JSON exposure          |

Copy `.env.example` and provide every required value for **development** infrastructure. The example contains names and comments only—no real credentials. Never commit `.env` or production credentials.

Staging is a deployment tier (future Liara), not a `NODE_ENV` value. Staging and production must use separate managed secrets and must never share databases or Redis.

`pnpm test` and `pnpm test:e2e` force `NODE_ENV=test`, ignore developer `.env` files, and do not require live PostgreSQL or Redis. Real infrastructure integration is a separate opt-in suite (`pnpm test:integration*`) that requires `INTEGRATION_TESTS_ENABLED=true` and dedicated `TEST_DATABASE_URL` / `TEST_REDIS_URL` resources—never production and never a silent reuse of developer `DATABASE_URL` / `REDIS_URL`.

## Development PostgreSQL

Preferred: a remote dedicated development database (separate credentials, safe to migrate/reset, never production customer data), configured only through local `.env`.

Optional: install PostgreSQL natively on the machine.

Optional (not default): Docker Compose PostgreSQL for contributors who already use Docker:

```bash
docker compose up -d postgres
```

Compose credentials are development-only and unsuitable for production. Do not treat Docker as the default local path.

## Redis and asynchronous work

Leave `REDIS_URL` blank to run without Redis. The API does not open a Redis connection in that mode. When a URL is provided, startup verifies the connection and fails if it cannot connect. Use only an isolated **development** instance—never production Redis.

Redis liveness is deliberately separate from API liveness. `GET /api/v1/health` remains a process-level liveness route. `RedisService.readiness()` exposes the internal configured/ready state for a future deployment readiness composition; no public readiness route is introduced by this foundation.

BullMQ is available only through the queue infrastructure boundary. The non-HTTP worker composition root is built as `dist/worker.js` (`pnpm worker`) and shares infrastructure/application modules with the API without starting HTTP. It refuses to run without an approved processor, so it is not independently deployed until a concrete queue processor is added. `SIGTERM`/`SIGINT` drain jobs within `WORKER_SHUTDOWN_TIMEOUT_MS`, then close BullMQ/Redis/Nest resources.

## Prisma workflow

```bash
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate:dev --name descriptive-change
pnpm prisma:migrate:deploy
```

Use `migrate dev` only during development and commit generated migrations. Staging and production use `migrate deploy`; never use `prisma db push` for those deployments. The initial schema deliberately contains no business models and therefore no migration. There is no seed runner yet; future seeds must be synthetic and must never run against production by accident.

## Development and verification

```bash
pnpm start:dev       # watch-mode development server
pnpm env:check       # local environment/toolchain sanity (no Docker required)
pnpm format          # apply formatting
pnpm format:check    # verify formatting
pnpm lint            # lint with zero allowed warnings
pnpm lint:fix        # apply safe lint fixes
pnpm typecheck       # strict TypeScript check
pnpm test            # unit tests (no live PostgreSQL/Redis required)
pnpm test:watch      # unit tests in watch mode
pnpm test:cov        # unit test coverage
pnpm test:e2e        # HTTP foundation tests (no live PostgreSQL/Redis required)
pnpm test:integration          # real PostgreSQL + Redis (opt-in; see below)
pnpm test:integration:postgres # real PostgreSQL only
pnpm test:integration:redis    # real Redis + BullMQ only
pnpm openapi:generate # write artifacts/openapi.json without a running server
pnpm openapi:check   # validate the generated OpenAPI document
pnpm build           # compile the production application
pnpm start           # run the compiled application
```

### Real infrastructure integration tests

Normal development does **not** need PostgreSQL or Redis integration services to run every test. Use the opt-in suite only when you intentionally want real infrastructure:

```bash
# Required:
#   INTEGRATION_TESTS_ENABLED=true
#   TEST_DATABASE_URL=postgresql://...   # dedicated disposable TEST DB
#   TEST_REDIS_URL=redis://...           # dedicated disposable TEST Redis
#
# Optional for truncate/reset helpers:
#   INTEGRATION_ALLOW_DESTRUCTIVE=true

pnpm test:integration
```

These commands fail clearly when the opt-in flag or required `TEST_*` URLs are missing. They never target production. Details: [instructions/testing.md](instructions/testing.md).

## OpenAPI

OpenAPI is generated from Nest controllers and DTOs via `@nestjs/swagger`.

| Surface            | Location                 | Default exposure                                              |
| ------------------ | ------------------------ | ------------------------------------------------------------- |
| Swagger UI         | `/docs`                  | Enabled in `development`; disabled in `test` and `production` |
| OpenAPI JSON       | `/docs-json`             | Same policy as Swagger UI                                     |
| Generated artifact | `artifacts/openapi.json` | Produced by `pnpm openapi:generate`; not committed            |

Set `OPENAPI_ENABLED=true` to enable documentation outside development (for example a staging host). Set `OPENAPI_ENABLED=false` to disable it even in development. Documentation routes are infrastructure surfaces and are not mounted under `/api/v1`.

`info.version` uses `APP_VERSION`. The HTTP contract version remains the `/api/v1` prefix.

Future storefront/admin TypeScript clients should generate from the approved OpenAPI document. Client generation is intentionally not part of this foundation.

Unit and lightweight HTTP e2e tests run without Redis or PostgreSQL. Opt-in real infrastructure coverage lives under `tests/integration/` and proves Prisma/Redis/BullMQ contact against dedicated `TEST_*` resources; mocked coverage is never labeled as integration coverage.

Pre-commit hooks run lint-staged on changed files. Commit messages are checked against Conventional Commits, for example `feat(orders): add cancellation flow`.

## Architecture

EggShip API is a modular monolith. The intended dependency flow is controller → application/service → repository/infrastructure → PostgreSQL. Controllers remain thin, Prisma stays out of domain and API contracts, and modules communicate through explicit exported services or contracts. See [AGENTS.md](AGENTS.md), the [engineering instructions](instructions/README.md), and the [architecture ADR](docs/adr/0001-modular-monolith.md).

The authoritative dependency-ordered implementation plan, task statuses, milestone definitions, and recorded business blockers live in [docs/ROADMAP.md](docs/ROADMAP.md).

The service is designed to be stateless and horizontally scalable: it keeps no important state in process memory and does not rely on ephemeral local disk for uploads. PostgreSQL is authoritative; Redis is optional and ephemeral. Graceful shutdown hooks close infrastructure resources. These choices prepare it for eventual Liara deployment, but this repository does not include a deployment pipeline yet.

Local development uses `.env`. Future Liara staging and production must each use separately managed environment variables and secrets.

## Observability

Requests receive a validated or generated `X-Request-Id`; the same value is the initial correlation ID and is available through `RequestContextService`. Structured JSON logs include safe request completion data and configured release metadata. Future modules use the vendor-independent `ApplicationLogger` API rather than Pino or console methods directly:

```ts
logger.info(
  { module: 'example', operation: 'performAction' },
  'Action completed',
);
```

Request/response bodies, sensitive headers, credentials, tokens, OTPs, and personal information are excluded or centrally redacted. See the [observability policy](instructions/observability.md).

## Releases

EggShip uses Semantic Versioning, Conventional Commits, `CHANGELOG.md`, annotated `vX.Y.Z` tags, and GitHub Releases. Publication is human-controlled; automation does not deploy production.

```bash
# Validate package.json + CHANGELOG consistency (no Docker/PostgreSQL/Redis)
pnpm release:check

# Prepare package.json + changelog for a new version (optional --dry-run)
pnpm release:prepare 0.2.0
pnpm release:prepare 0.2.0 --dry-run
```

Typical human flow after preparation: review the diff → commit → `git tag -a vX.Y.Z -m "EggShip API vX.Y.Z"` → push commit and tag. Pushing a `v*` tag runs the Release workflow, which re-checks quality and creates the GitHub Release from the changelog section.

Runtime builds should set `APP_VERSION` to the release version and `GIT_SHA` to the commit that produced the binary. Local development may use values such as `APP_VERSION=0.1.0` and `GIT_SHA=local`.

Canonical policy: [instructions/releases.md](instructions/releases.md).

## AI-assisted development

[AGENTS.md](AGENTS.md) is the canonical instruction entry point for Codex, Claude, Cursor, and other coding agents. Agents must read the relevant linked policies before changing the repository and must stop rather than invent unresolved business or architecture decisions.

Host-specific adapters live under `.cursor/`, `.claude/`, and `.codex/` and must not duplicate policy. Shared workflows live in [docs/agent-workflows](docs/agent-workflows/). See [instructions/agent-tooling.md](instructions/agent-tooling.md). Validate adapter drift with `pnpm check:agent-tooling`. No project-scoped MCP servers are enabled yet.
