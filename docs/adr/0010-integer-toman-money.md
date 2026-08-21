# ADR 0010: Integer Toman money representation

## Status

Accepted

## Context

EggShip sells products in Iranian Toman. The API contract already states that monetary values are integers expressed in Toman. CAT-03 introduces the first persistent money field (`Product.price`). The repository needs a durable choice for storage type, JSON serialization, and unit naming so Pricing, Orders, and Discounts do not diverge.

Alternatives considered:

- Floating-point numbers (unsafe for money).
- Storing Rial and converting implicitly (ambiguous naming and conversion bugs).
- PostgreSQL `NUMERIC`/`Decimal` with fractional subunits (unnecessary when the business unit is whole Toman).
- PostgreSQL `BIGINT` / Prisma `BigInt` (JSON becomes string in JavaScript; EggShip catalog prices fit comfortably in 32-bit signed integers).

## Decision

- Business currency is **Toman**.
- Persist and expose money as **integer Toman** with no fractional subunit.
- Use PostgreSQL `INTEGER` (Prisma `Int`) for `Product.price` and the same pattern for future money columns unless a specific amount exceeds int4 range.
- API field name is **`price`** (not `priceToman`); OpenAPI and docs state the unit explicitly.
- Reject non-positive prices for Product (`price > 0`) as the initial commercial rule pending MIG-01 evidence.
- Do not store Rial, dual units, or floating point.

## Consequences

- JSON responses remain ordinary numbers within `Number.MAX_SAFE_INTEGER`.
- PriceHistory (PRC-01) and Order snapshots (ORD-01) must use the same integer-Toman rule.
- Amounts above 2,147,483,647 Toman would require a separate schema decision (unlikely for EggShip catalog prices).
- Zero-price products are intentionally disallowed until business evidence says otherwise.
