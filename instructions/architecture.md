# Architecture

EggShip API is a modular monolith. HTTP requests flow from controller to application/service code, then to repository/infrastructure code and PostgreSQL.

Simple resource modules may use `controller`, `service`, `repository`, DTOs, and tests. Complex domains may separate `api`, `application`, `domain`, `infrastructure`, and `tests`. Choose complexity based on demonstrated domain needs, not anticipation.

- Controllers translate HTTP concerns and remain thin. Business logic does not belong in controllers.
- Prisma is an infrastructure technology and must not leak into domain logic or public response contracts.
- Domain modules communicate through explicit exported services or contracts. Avoid circular dependencies and hidden cross-module database access.
- A module must not mutate another module's owned data through its repository or persistence tables. Cross-domain behavior uses an application-level contract owned by the target module.
- Direct cross-module database reads must not bypass the owning module's business invariants.
- Do not introduce speculative infrastructure, generic base repositories/services, or generic CRUD controller abstractions.
- Do not silently broaden a feature or infrastructure task into unrelated refactors.
- Microservices require explicit approval. Do not prematurely add CQRS or event sourcing.
- The service is stateless and designed for horizontal scaling. Important state belongs in durable services, not process memory or ephemeral local disk. Object bytes use `StorageProvider` (see [media.md](media.md)); they are not stored on local application disk.
- Feature modules should access Prisma through their infrastructure/repository layer when domain complexity warrants that boundary.
- Referral attribution is a bounded domain concern. Future referral services own referral invariants and expose application contracts to Auth; Auth must not reach into referral tables directly, and referral code transport/capture must not create click-tracking state.
