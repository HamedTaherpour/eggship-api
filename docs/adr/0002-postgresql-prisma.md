# ADR 0002: PostgreSQL and Prisma

## Status

Accepted

## Context

EggShip needs durable relational storage, transactional integrity, constraints, migrations, and productive type-safe data access.

## Decision

Use PostgreSQL as the source of truth and Prisma as the persistence toolkit. Keep Prisma types and calls in infrastructure/repository code rather than domain contracts. Version and review migrations, and deploy them with `prisma migrate deploy`.

## Consequences

The application gains strong relational guarantees and a consistent schema workflow. Prisma-generated code becomes a build prerequisite, and developers must avoid coupling domain behavior or API responses to generated persistence models.
