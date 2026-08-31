# ORD-08 verification evidence

ORD-08 is a correctness and bounded-representative verification task. The PostgreSQL suites use `ConcurrencyGate` for deterministic overlap and inspect committed Order, OrderLine, Inventory, InventoryReservation, InventoryLedger, DiscountUsage, and AuditLog state. They do not use sleeps or claim production capacity.

The representative bounded load is the N-way hot-SKU Order creation test: eight distinct customers request one unit each against five units of stock. The expected durable result is five successful Orders and three rejected requests, five active reservations, five reserve ledger rows, five `order.created` AuditLog rows, and `reserved = 5 <= initial onHand = 5`. This is an invariant proof, not a throughput or latency target.

The `ord-08-query-analysis.integration-spec.ts` suite runs real PostgreSQL `EXPLAIN (FORMAT JSON)` for customer Order list, Order detail, the conditional transition update, and the user/idempotency lookup. The relevant production indexes already exist: `Order(userId, createdAt)`, `Order(status, createdAt)`, `Order(createdAt)`, and the unique `(userId, idempotencyKey)` constraint. Detail and transition lookups are primary-key probes. Sequential scans on tiny fixture tables are acceptable; the test does not turn fixture plans into index requirements.

Result: **NO PRODUCTION QUERY CHANGE REQUIRED.** Full deployed API load, spike, stress, soak, and connection-pool capacity evidence remain REL-03/REL-04/REL-05 work.
