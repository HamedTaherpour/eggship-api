# ADR 0013: Order historical snapshots and aggregate money storage

## Status

Accepted

## Context

ORD-01 introduces the first Order persistence model. EggShip is a wholesale ordering system where warehouse operations fulfill orders and payment settles outside the application (no V1 payment gateway). Business records must remain intelligible after Products are renamed or repriced, Users change phone/profile data, and Regions are renamed or deactivated.

ADR 0010 locks integer Toman for `Product.price` (int4). Order lines multiply `unitPrice × quantity` and orders sum multiple lines — products at int4 max price with quantity > 1 exceed int4 for line totals. JSON API responses must remain exact without floating point.

Alternatives considered:

- Derive `lineTotal` at read time (weak audit trail; harder discount allocation in PRC-05).
- Store all order money as int4 (unsafe for line totals and multi-line orders).
- PostgreSQL `NUMERIC` / Prisma `Decimal` (unnecessary when business unit is whole Toman; adds serialization complexity).
- JSON blob snapshots (avoids explicit columns; conflicts with database constraints and query needs).

## Decision

- Persist **immutable snapshot columns** on `Order` and `OrderLine` at creation time: product title, unit price, persisted line total, customer phone, region name, and order-time subtotal/total.
- Retain **FK references** (`productId`, `regionId`, `userId`) with `ON DELETE RESTRICT` for traceability; historical display uses snapshots, not live joined mutable fields.
- `OrderLine.unitPrice` stays **int4** (aligned with `Product.price`).
- `OrderLine.lineTotal`, `Order.subtotal`, and `Order.total` use **PostgreSQL BIGINT** / Prisma `BigInt`.
- Application code computes all money with **bigint** helpers; rejects overflow above BIGINT max.
- HTTP layers (ORD-04+) emit JSON numbers when `<= Number.MAX_SAFE_INTEGER`, otherwise exact decimal strings.
- Optional `Order.idempotencyKey` with `UNIQUE(userId, idempotencyKey)` prepares ORD-03; Inventory keeps opaque `orderId` without an Order FK.
- Address/profile snapshots and discount totals remain deferred until evidenced profile/pricing tasks land.

## Consequences

- Product/User/Region mutations never rewrite historical order display data.
- Large wholesale totals remain exact without float drift.
- API mappers must handle bigint → JSON explicitly.
- PRC discount snapshots will extend order money fields in a later task without changing the snapshot principle.
- Shipping address columns will be added when User/profile address fields exist — documented as deferred in `instructions/orders.md`.
