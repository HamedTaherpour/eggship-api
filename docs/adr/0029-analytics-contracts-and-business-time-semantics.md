# ADR 0029: Analytics contracts and business-time semantics (ANL-01)

Status: Accepted for ANL-02 and ANL-03 implementation.

Analytics V1 is derived from durable PostgreSQL business records. The system
does not add an analytics event stream, warehouse, aggregation/materialized-
view tables, or persisted daily inventory snapshots. ANL-04 must establish
measured query plans and load evidence before performance structures or
additional indexes are proposed.

The immutable analytics business timezone is the IANA `Asia/Tehran` timezone.
Local business-date ranges become half-open UTC ranges from the start of the
Tehran day through the start of the next Tehran day. Lifecycle metrics use
their own `Order` timestamps: `createdAt`, `confirmedAt`, `shippedAt`,
`deliveredAt`, and `cancelledAt`. Sales means delivered orders by `deliveredAt`,
with integer-Toman `grossSales`, line discounts, order discounts, total
discounts, and `netSales` sourced from immutable order totals. This is not
accounting revenue, and settlement is not revenue recognition.

Returns are operational only: returned, sellable-returned,
damaged-returned, and restocked quantities. They do not infer financial value
or reduce delivered sales. Top products require a declared basis:
`DELIVERED_QUANTITY` (default), `DELIVERED_VALUE`, or `SHIPPED_QUANTITY`.
Delivered value is safely defined as immutable `OrderLine.finalLineTotal`
without invented allocation of order-level discounts.

Historical product and pricing facts use immutable OrderLine snapshots.
Category-based historical analytics is not supported because the current
schema does not provide a sufficient immutable category snapshot. Inventory
daily balances are reconstructed from the append-only InventoryLedger;
current availability remains `onHand - reserved`. PriceHistory is authoritative
for actual changes, grouped by Tehran day without collapsing multiple changes;
its lack of an initial-price event is explicit.

Current-state metrics are request-time, freshness-sensitive snapshots.
Historical closed periods may be cached later. No TTL is selected here.
Admin analytics remains behind `ANALYTICS_READ`; endpoint and query contracts
are owned by ANL-02/ANL-03. Financial accounting, refunds, credits, taxes,
shipping revenue, and revenue recognition require a separate explicit decision.
