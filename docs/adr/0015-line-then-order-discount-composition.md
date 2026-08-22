# ADR 0015: V1 LINE then ORDER discount composition

## Status

Accepted

## Context

PRC-03 delivers a pure single-winner discount calculator per invocation (`LINE` for `PRODUCT`/`CATEGORY`, `ORDER` for order-level targets). PRC-05 must compose those invocations into one order pricing snapshot for ORD-03. Cross-scope stacking was previously unresolved: whether LINE and ORDER winners may both apply, and whether an ORDER discount bases on pre-discount gross or post-LINE subtotal.

Alternatives considered:

- Mutually exclusive scopes (LINE **or** ORDER, never both).
- ORDER discount against pre-discount gross while LINE discounts still reduce line display totals (inconsistent payable math).
- Multi-winner stacking within a scope (rejected by PRC-03 V1).

## Decision

V1 composition is **LINE then ORDER on the discounted subtotal**:

1. Each line receives at most one LINE-scope winner (`PRODUCT` or `CATEGORY`), selected by PRC-03 precedence / ascending-`id` tie-break.
2. `grossLineTotal = unitPrice × quantity`; `finalLineTotal = grossLineTotal − lineDiscountAmount`.
3. `subtotalAfterLineDiscounts = Σ finalLineTotal`.
4. At most one ORDER-scope winner applies to **exactly** `subtotalAfterLineDiscounts` (not pre-discount gross).
5. `total = subtotalAfterLineDiscounts − orderDiscountAmount`.
6. No same-scope stacking; cross-scope composition (one LINE winner per line, then one ORDER winner) is allowed.
7. One shared `evaluatedAt` instant for the whole pricing operation.
8. PRC-05 remains **persistence-neutral**. ORD-03 owns any Order/OrderLine migration needed to store discounted amounts and applied-discount evidence. ORD-01 `lineTotal = unitPrice × quantity` is not relaxed in PRC-05.

## Consequences

- Displayed and ordered pricing share one composition rule.
- ORD-03 can call `OrderPricingService.priceOrderLines` inside its create transaction without re-deriving discount math.
- Future stacking, promo codes, usage limits, or min-order thresholds require an explicit policy change beyond this ADR.
