# ADR 0001: Modular monolith

## Status

Accepted

## Context

EggShip needs clear domain ownership and maintainable boundaries without the operational cost and distributed consistency problems of independent services at its current stage.

## Decision

Build one deployable NestJS application as a modular monolith. Modules expose explicit application services or contracts; controllers stay thin; infrastructure dependencies point inward through module-owned boundaries. Simple and complex modules may use different internal depth based on demonstrated needs.

## Consequences

Deployment and local development remain simple, and transactions can span related data safely. Module boundaries require discipline because the runtime does not enforce network separation. Moving a module to a separate service later requires an explicit ADR and demonstrated need.
