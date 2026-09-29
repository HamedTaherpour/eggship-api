# EggShip Backend

### AI-native, production-minded backend engineering case study

EggShip is the backend of a **B2B commerce platform for wholesale egg ordering**, built with **NestJS, TypeScript, PostgreSQL, Prisma, Redis, and BullMQ**.

This repository is both a backend project and an engineering case study exploring a specific question:

> **How far can modern AI coding agents be integrated into serious software engineering while architecture, product decisions, constraints, reviews, and final approval remain human-controlled?**

EggShip was intentionally designed as more than a CRUD demo.

The backend addresses authentication and session management, authorization, catalog and pricing, inventory, transactional ordering, concurrency, referrals, notifications, analytics, background processing, observability, API contracts, and multiple layers of automated testing.

A major focus of the project is **AI-native software engineering**.

AI agents are used throughout implementation, analysis, testing, documentation, and review, but they operate within explicit repository-defined engineering constraints.

Architecture decisions, business rules, security boundaries, testing requirements, and unresolved decisions are documented in the repository. Agents are instructed to stop when a business or architectural decision is ambiguous rather than silently inventing requirements.

The goal is not simply to demonstrate that AI can generate code.

The goal is to explore how **AI agents can participate in a disciplined engineering process for building and maintaining a non-trivial backend system.**

---

## Engineering Highlights

- Modular Monolith architecture
- NestJS with strict TypeScript
- PostgreSQL as the authoritative datastore
- Prisma ORM and explicit migration workflow
- Redis-backed infrastructure
- BullMQ background processing
- Separate HTTP API and worker composition roots
- Customer and Admin authentication boundaries
- Short-lived JWT access tokens
- Rotating refresh-token sessions
- Cookie authentication and CSRF protection
- Role/permission-based authorization
- Ownership enforcement
- OTP authentication flows
- Transactional order creation
- Idempotent write operations
- Inventory ledger and reservation lifecycle
- Concurrency-aware stock handling
- Pricing and discount rules
- Historical order and pricing snapshots
- Referral attribution
- Durable notification infrastructure
- Media/object-storage integration
- Business analytics
- Structured Pino logging
- Request and correlation IDs
- Sensitive-data log redaction
- OpenAPI contract generation and verification
- Unit testing
- HTTP/E2E testing
- Real PostgreSQL/Redis integration testing
- Concurrency testing
- Load/performance test harness
- GitHub Actions CI
- Conventional Commits
- Semantic Versioning and GitHub Releases
- Architecture Decision Records
- Repository-level AI governance

---

# Why This Repository Exists

Many AI-assisted projects demonstrate how quickly an AI model can generate an application.

EggShip explores a different problem:

**How should AI-generated engineering work be controlled when the system contains real architectural, security, transactional, and concurrency constraints?**

Instead of relying primarily on conversational context, important engineering knowledge is stored alongside the source code.

The repository contains:

- architecture rules
- API conventions
- authentication and authorization policies
- database rules
- security requirements
- testing policies
- observability conventions
- queue semantics
- release policies
- Architecture Decision Records
- Definition of Done
- an explicit implementation roadmap
- instructions specifically written for AI coding agents

This allows coding agents to work from a persistent engineering context rather than reconstructing the architecture from individual prompts.

---

# AI-Native Engineering Workflow

AI is treated as an **engineering participant**, not an unrestricted code generator.

The workflow deliberately separates implementation authority from decision authority.

| Responsibility | Ownership |
| --- | --- |
| Product direction | Human |
| Business decisions | Human |
| Architecture approval | Human |
| Security-sensitive decisions | Human |
| Task decomposition | Human + AI |
| Implementation | AI agents |
| Test generation | AI agents |
| Documentation | Human + AI |
| Code analysis | AI agents |
| Cross-agent review | AI agents + Human |
| Architecture gates | Human |
| Final approval | Human |

The repository currently supports agent workflows for tools including:

- Codex
- Claude
- Cursor

`AGENTS.md` is the canonical entry point for coding agents.

Host-specific configuration lives under:

```text
.cursor/
.claude/
.codex/
```

Shared engineering rules remain independent from a particular AI provider.

## A critical rule

One of the most important rules given to agents is:

> **Do not invent unresolved business or architecture decisions. Stop and surface the ambiguity.**

This distinction matters.

An agent may be capable of generating a technically valid implementation while still making the wrong product, security, or architectural assumption.

The repository therefore treats unresolved decisions as explicit engineering state.

See:

- [`AGENTS.md`](AGENTS.md)
- [`instructions/ai-governance.md`](instructions/ai-governance.md)
- [`instructions/agent-tooling.md`](instructions/agent-tooling.md)
- [`instructions/definition-of-done.md`](instructions/definition-of-done.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

# Engineering Problems Explored

The project intentionally includes problems that go beyond basic API development.

Examples include:

### Concurrent inventory

What happens when multiple customers attempt to purchase the same limited stock at the same time?

The system must prevent overselling even when requests execute concurrently.

This requires reasoning about:

- database transactions
- inventory reservations
- physical stock
- concurrent writes
- order lifecycle transitions
- rollback behavior

### Idempotent ordering

What happens when a client retries an order request because the original response was lost?

A retry must not accidentally create multiple orders.

Write operations therefore require explicit idempotency semantics where appropriate.

### Session rotation

Refresh tokens are rotated rather than treated as permanently reusable credentials.

That introduces additional questions:

- What happens when two refresh requests race?
- When does the previous session become invalid?
- How should token families behave?
- How are revoked sessions represented?

These scenarios are tested rather than handled only as happy-path authentication.

### Historical correctness

Commerce data changes over time.

A product price changing tomorrow must not rewrite what an order cost yesterday.

Orders therefore preserve historical snapshots where required instead of relying only on current product state.

### Inventory semantics

"Available", "reserved", and physical stock are not necessarily the same concept.

EggShip explicitly models inventory lifecycle rules instead of representing inventory as a single number modified from arbitrary modules.

### Authentication boundaries

Customer identity and Admin identity are separate concerns.

Authentication, permissions, ownership, cookie behavior, CSRF protection, and session lifecycle are treated as architectural boundaries rather than controller-level checks added ad hoc.

### Background processing

Asynchronous work introduces failure scenarios:

- retries
- duplicate delivery
- idempotency
- worker shutdown
- Redis availability
- job retention
- payload limits

BullMQ is therefore wrapped behind explicit infrastructure policies rather than being called freely throughout the application.

---

# Architecture

EggShip uses a **Modular Monolith** architecture.

The goal is to maintain clear domain and dependency boundaries without introducing distributed-system complexity before it is justified.

```text
                         ┌─────────────────────┐
                         │ Storefront / Admin  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     NestJS API      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Application Layer   │
                         └──────────┬──────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  │                 │                 │
                  ▼                 ▼                 ▼
          ┌──────────────┐   ┌──────────────┐  ┌──────────────┐
          │ Repositories │   │    Redis     │  │    BullMQ    │
          └──────┬───────┘   └──────────────┘  └──────┬───────┘
                 │                                      │
                 ▼                                      ▼
          ┌──────────────┐                       ┌──────────────┐
          │ PostgreSQL   │                       │    Worker    │
          │   Prisma     │                       └──────┬───────┘
          └──────────────┘                              │
                                                       ▼
                                                Infrastructure
```

The primary dependency direction is:

```text
Controller
    ↓
Application / Service
    ↓
Repository / Infrastructure
    ↓
PostgreSQL
```

Controllers remain thin.

Prisma is kept out of API contracts and higher-level domain boundaries where possible.

Modules communicate through explicit services/contracts rather than arbitrary cross-module database access.

The application is designed to remain stateless at the API layer so multiple instances can eventually run behind a load balancer.

PostgreSQL remains authoritative.

Redis is treated as ephemeral infrastructure rather than a source of truth.

For the architectural rationale, see:

[`docs/adr/0001-modular-monolith.md`](docs/adr/0001-modular-monolith.md)

---

# Architecture Decision Records

Important architectural choices are recorded as ADRs instead of being left only in commit history or AI conversations.

They live under:

```text
docs/adr/
```

ADRs document decisions around areas such as:

- modular architecture
- authentication
- Admin identity
- inventory
- ordering
- discounts
- settlement
- referrals
- media
- analytics
- concurrency-sensitive behavior

This is particularly important in an AI-assisted project because future agents need to understand **why a constraint exists**, not merely observe the resulting code.

---

# Testing Strategy

EggShip deliberately separates different kinds of tests.

```text
                  ┌─────────────┐
                  │ Unit Tests  │
                  └──────┬──────┘
                         ▼
                  ┌─────────────┐
                  │ HTTP / E2E  │
                  └──────┬──────┘
                         ▼
              ┌─────────────────────┐
              │ Real Infrastructure │
              │ Integration Tests   │
              └──────────┬──────────┘
                         ▼
               ┌───────────────────┐
               │ Concurrency Tests │
               └─────────┬─────────┘
                         ▼
               ┌───────────────────┐
               │ Load / Performance│
               └───────────────────┘
```

### Unit tests

Fast tests for isolated behavior and business logic.

They do not require live PostgreSQL or Redis.

### HTTP / E2E tests

Verify HTTP contracts and application behavior through the NestJS boundary.

### Integration tests

A separate opt-in suite communicates with **real PostgreSQL and Redis infrastructure**.

Mock-based tests are not labeled as infrastructure integration tests.

### Concurrency tests

Concurrency-sensitive operations are tested explicitly.

These tests are particularly important for areas such as:

- session rotation
- inventory
- reservations
- order creation
- state transitions

### Load testing

The repository includes a load/performance harness for measuring selected scenarios.

Load tests are used as engineering evidence and diagnostics.

Local measurements are **not presented as production capacity claims**.

---

# Security Approach

Security is treated as a cross-cutting engineering requirement.

Every meaningful change is expected to consider:

- input validation
- authentication
- authorization
- ownership
- secret handling
- logging
- database safety
- API exposure

Examples of implemented security-oriented practices include:

- strict request validation
- short-lived access tokens
- refresh-token rotation
- session revocation
- separate Admin/customer identity boundaries
- permission checks
- ownership checks
- cookie security rules
- CSRF protection for cookie-authenticated mutations
- sensitive log redaction
- environment validation
- isolated test infrastructure
- explicit destructive-operation gates

See:

[`instructions/security.md`](instructions/security.md)

[`instructions/authentication.md`](instructions/authentication.md)

[`instructions/authorization.md`](instructions/authorization.md)

---

# Observability

The application uses structured logging through **Pino** behind a provider-independent application logging boundary.

Incoming requests receive a validated or generated request ID.

That identifier becomes part of the request context and can be propagated through application operations.

Example:

```ts
logger.info(
  {
    module: 'orders',
    operation: 'createOrder',
  },
  'Order created',
);
```

Sensitive information is deliberately excluded or centrally redacted.

This includes data such as:

- credentials
- access tokens
- refresh tokens
- OTP values
- sensitive headers
- request/response data that may contain personal information

The goal is to make logs useful for production diagnosis without turning logging infrastructure into a data-leak surface.

See:

[`instructions/observability.md`](instructions/observability.md)

---

# Redis and Background Workers

Redis is optional infrastructure.

When `REDIS_URL` is not configured, the API can operate without opening a Redis connection for capabilities that do not require it.

When Redis is configured, connection readiness is explicitly managed.

BullMQ provides asynchronous job infrastructure.

The worker has a separate non-HTTP composition root:

```text
API
 │
 ├── Application modules
 │
 └── Queue producer
          │
          ▼
        Redis
          │
          ▼
        BullMQ
          │
          ▼
        Worker
```

Worker shutdown is graceful.

On termination signals, the application attempts to drain active work and close BullMQ, Redis, and NestJS resources within configured shutdown limits.

Queue behavior is governed by explicit policies covering:

- retries
- backoff
- payload limits
- retention
- idempotency
- shutdown behavior

See:

[`instructions/redis.md`](instructions/redis.md)

[`instructions/queues.md`](instructions/queues.md)

---

# API Contracts

The API is versioned under:

```text
/api/v1
```

OpenAPI is generated from NestJS controllers and DTOs using `@nestjs/swagger`.

| Surface | Location |
| --- | --- |
| Swagger UI | `/docs` |
| OpenAPI JSON | `/docs-json` |
| Generated contract | `artifacts/openapi.json` |

Swagger/OpenAPI exposure can be controlled independently through environment configuration.

The generated contract can also be validated without manually running the server:

```bash
pnpm openapi:generate
pnpm openapi:check
```

The long-term intention is for frontend clients to consume verified API contracts rather than manually duplicating backend types.

---

# Technology Stack

### Core

- Node.js 24
- TypeScript
- NestJS

### Data

- PostgreSQL
- Prisma ORM
- `pg`

### Infrastructure

- Redis
- ioredis
- BullMQ
- S3-compatible object storage

### Authentication & Security

- JWT
- Argon2
- OTP infrastructure
- cookie-based browser authentication
- CSRF protection
- RBAC / permission checks

### Observability

- Pino
- request/correlation context
- structured JSON logging

### Testing

- Jest
- NestJS testing utilities
- Supertest
- real PostgreSQL integration tests
- real Redis integration tests
- concurrency tests
- load/performance harness

### Engineering Tooling

- ESLint
- Prettier
- Husky
- lint-staged
- commitlint
- GitHub Actions
- Conventional Commits
- Semantic Versioning

---

# Project Roadmap

Development is tracked through a dependency-ordered engineering roadmap rather than an informal feature checklist.

The roadmap records:

- implementation tasks
- dependencies
- acceptance criteria
- architecture gates
- human approval gates
- blocked decisions
- explicitly deferred work
- milestone completion criteria

See:

[`docs/ROADMAP.md`](docs/ROADMAP.md)

The roadmap should be treated as the source of truth for current implementation status. This README intentionally avoids hard-coding progress counts that would quickly become stale.

---

# Repository Documentation

The repository contains significantly more engineering documentation than this README can summarize.

```text
AGENTS.md
│
├── instructions/
│   ├── architecture.md
│   ├── api-contract.md
│   ├── authentication.md
│   ├── authorization.md
│   ├── security.md
│   ├── database.md
│   ├── inventory.md
│   ├── orders.md
│   ├── pricing.md
│   ├── queues.md
│   ├── redis.md
│   ├── observability.md
│   ├── testing.md
│   ├── releases.md
│   ├── ai-governance.md
│   └── definition-of-done.md
│
└── docs/
    ├── ROADMAP.md
    ├── adr/
    └── agent-workflows/
```

For AI agents, start with:

[`AGENTS.md`](AGENTS.md)

For humans exploring the engineering decisions, useful starting points are:

- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/adr/`](docs/adr/)
- [`instructions/architecture.md`](instructions/architecture.md)
- [`instructions/testing.md`](instructions/testing.md)
- [`instructions/security.md`](instructions/security.md)

---

# Getting Started

## Requirements

- Node.js 24
- pnpm 10+
- PostgreSQL when exercising persistence
- Redis only when exercising Redis-backed capabilities

Docker is **not required** for normal local development.

---

## Install

Clone the repository:

```bash
git clone https://github.com/HamedTaherpour/eggship-backend.git
cd eggship-backend
```

Enable Corepack:

```bash
corepack enable
```

Install dependencies:

```bash
pnpm install
```

Create the local environment file:

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### POSIX

```bash
cp .env.example .env
```

Configure the required development values and generate Prisma Client:

```bash
pnpm prisma:generate
```

Start the development server:

```bash
pnpm start:dev
```

The API listens on the configured `PORT`.

Health endpoint:

```text
GET /api/v1/health
```

---

# Environment

Core environment variables include:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | Runtime environment |
| `PORT` | Yes | HTTP port |
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `APP_VERSION` | Yes | Runtime release version |
| `GIT_SHA` | Yes | Source revision |
| `REDIS_URL` | No | Redis connection |
| `OPENAPI_ENABLED` | No | OpenAPI/Swagger exposure |

Run the environment sanity check with:

```bash
pnpm env:check
```

Development, test, staging, and production infrastructure must remain isolated.

Production credentials must never be reused for local development or automated tests.

For the complete environment policy, see:

[`instructions/environment.md`](instructions/environment.md)

---

# Prisma Workflow

Common database commands:

```bash
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate:dev --name descriptive-change
pnpm prisma:migrate:deploy
```

Development migrations use:

```bash
prisma migrate dev
```

Deployment environments use:

```bash
prisma migrate deploy
```

`prisma db push` is not used as a substitute for reviewed production migrations.

Database rules are documented in:

[`instructions/database.md`](instructions/database.md)

---

# Development Commands

```bash
# Development
pnpm start:dev
pnpm env:check

# Code quality
pnpm format
pnpm format:check
pnpm lint
pnpm lint:fix
pnpm typecheck

# Tests
pnpm test
pnpm test:watch
pnpm test:cov
pnpm test:e2e

# Real infrastructure integration
pnpm test:integration
pnpm test:integration:postgres
pnpm test:integration:redis
pnpm test:integration:storage

# OpenAPI
pnpm openapi:generate
pnpm openapi:check

# Build
pnpm build
pnpm start
```

The repository also contains dedicated load/performance commands for supported scenarios.

Check `package.json` and the testing documentation for the current command set.

---

# Real Infrastructure Integration Tests

Normal unit and HTTP tests do not require live PostgreSQL or Redis.

Real infrastructure testing is deliberately opt-in.

Example:

```bash
INTEGRATION_TESTS_ENABLED=true
TEST_DATABASE_URL=postgresql://...
TEST_REDIS_URL=redis://...
pnpm test:integration
```

Destructive test helpers require an additional explicit opt-in.

Integration tests must use dedicated disposable resources.

They must never target production infrastructure.

See:

[`instructions/testing.md`](instructions/testing.md)

---

# Releases

EggShip uses:

- Semantic Versioning
- Conventional Commits
- `CHANGELOG.md`
- annotated Git tags
- GitHub Releases

Release consistency can be checked with:

```bash
pnpm release:check
```

A release can be prepared with:

```bash
pnpm release:prepare 0.2.0
```

or previewed with:

```bash
pnpm release:prepare 0.2.0 --dry-run
```

Release publication remains human-controlled.

See:

[`instructions/releases.md`](instructions/releases.md)

---

# Engineering Philosophy

A few principles shape this repository:

**Architecture before implementation.**

AI agents should implement within approved boundaries rather than redefine those boundaries while coding.

**Business ambiguity is not an invitation to guess.**

Unknown requirements remain explicit until a human decision is made.

**The database is part of the concurrency model.**

Correctness cannot depend only on in-process JavaScript logic when multiple API instances or requests may operate concurrently.

**Tests should prove the layer they claim to test.**

A mocked database test is useful, but it is not a real database integration test.

**Infrastructure failures are normal engineering scenarios.**

Redis failures, retries, duplicate requests, worker shutdown, concurrent writes, and partial failures are considered part of system design.

**Documentation is part of the system.**

Architecture rules, ADRs, policies, and agent instructions are maintained alongside the implementation.

**AI output is not automatically an engineering decision.**

Agents can propose and implement solutions. Product, architecture, security, and final approval remain human responsibilities.

---

# About This Case Study

EggShip is an ongoing engineering project.

It is intentionally developed in public as both a backend implementation and a record of an **AI-assisted software engineering workflow**.

The repository is not presented as evidence of a particular production traffic capacity unless that capacity has been measured in an appropriate production-like environment.

Instead, it demonstrates the engineering work involved in preparing a backend for concerns such as:

- concurrency
- transactional correctness
- horizontal scaling
- security
- observability
- asynchronous processing
- failure handling
- maintainability
- automated verification
- AI-assisted development governance

That distinction is intentional:

> **Designing for scale is not the same as claiming scale.**

---

## Author

**Hamed Taherpour**

Backend engineering, architecture, and AI-assisted software development.

---

## License

This repository is published as a portfolio and engineering case study.

See the repository license and usage terms before reusing the source code.
