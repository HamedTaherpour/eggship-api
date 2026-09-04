# Analytics architecture (ANL-01 / ADR 0029)

Analytics V1 is a read-side contract derived from durable PostgreSQL business
records. It does not create a parallel event stream, analytics datastore,
aggregation table, materialized view, inventory snapshot table, or cache
authority. Query and endpoint implementation belongs to ANL-02 and ANL-03;
measured query/index work belongs to ANL-04.

## Terminology and business day

The analytics business timezone is the IANA timezone `Asia/Tehran`. An
analytics day is the Tehran calendar day; it is neither a UTC calendar day nor
the commerce ordering window/day.

An API range expressed as local business dates is converted to the half-open
UTC instant range:

```text
[startOfTehranDay, startOfNextTehranDay)
```

The conversion uses IANA timezone rules. No UTC offset is hard-coded. Event
metrics use the event's own timestamp, not a timestamp copied from another
stage of the order lifecycle.

Initial read contracts are bounded by purpose: product price history/current
stock/daily stock and movement analytics in ANL-02; sales overview, top
products, and today pulse in ANL-03. Admin analytics uses the existing
`ANALYTICS_READ` permission and central authorization boundary. No analytics
HTTP endpoint is introduced by ANL-01.

## Order lifecycle and sales

The lifecycle metrics are counted independently:

| Metric            | Timestamp           | Population                    |
| ----------------- | ------------------- | ----------------------------- |
| `ordersCreated`   | `Order.createdAt`   | orders created in the range   |
| `ordersConfirmed` | `Order.confirmedAt` | orders confirmed in the range |
| `ordersShipped`   | `Order.shippedAt`   | orders shipped in the range   |
| `ordersDelivered` | `Order.deliveredAt` | orders delivered in the range |
| `ordersCancelled` | `Order.cancelledAt` | orders cancelled in the range |

Null lifecycle timestamps do not count. An order created on one day and
delivered on another contributes to each corresponding day only.

V1 **sales means delivered orders**, and the sales date is `deliveredAt`.
Sales is not accounting revenue. Settlement is not revenue recognition.
Payment accounting, refunds, credits, taxes, shipping revenue, and revenue
recognition are not modeled.

For delivered orders, all money is integer Toman:

```text
grossSales    = sum(Order.grossSubtotal)
lineDiscounts = sum(Order.lineDiscountTotal)
orderDiscounts = sum(Order.orderDiscountAmount)
totalDiscounts = lineDiscounts + orderDiscounts
netSales      = sum(Order.total)
```

The value of newly created orders, if exposed later, is named
`createdOrderValue` and is not sales. Cancellation metrics are separate;
cancellations are excluded from sales and may expose `cancelledOrderValue`
from immutable `Order.total`. V1 does not financially reverse a reported sale.

## Returns

Returns are operational analytics only. Return-event grouping uses the
durable return event timestamp (`OrderReturn.createdAt`). Allowed V1 measures
are:

```text
returnedQuantity          = sellableQuantity + damagedQuantity
sellableReturnedQuantity  = sum(sellableQuantity)
damagedReturnedQuantity   = sum(damagedQuantity)
restockedQuantity         = quantity returned to stock by the InventoryLedger RETURN movement
```

Returns do not infer refund value, subtract from `netSales`, or imply credit or
accounting behavior. A delivered order remains delivered sales if an
operational return is recorded later. Return quantities are bounded by the
durable order-line return rules.

## Top products and historical metadata

Top-product queries require an explicit basis. V1 supports:

- `DELIVERED_QUANTITY`: sum `OrderLine.quantity` for orders with
  `deliveredAt` in the range (the default Admin/product interpretation).
- `SHIPPED_QUANTITY`: sum `OrderLine.quantity` for orders with `shippedAt` in
  the range.
- `DELIVERED_VALUE`: rank by delivered order-line value using immutable line
  snapshots. The safe V1 definition is sum of `OrderLine.finalLineTotal`,
  which includes line discounts but does not allocate order-level discounts
  to lines. It must not be presented as net sales.

Historical product identity, name, unit price, and line pricing use immutable
`OrderLine` snapshots where available. Category analytics is not supported in
V1: category identity is not snapshotted sufficiently to prevent current
category metadata from rewriting history. Current category joins must not be
presented as historical truth.

## Inventory analytics

Current stock is authoritative in `Inventory`:

```text
available = onHand - reserved
```

Movement analytics derive from append-only `InventoryLedger`. V1 does not
persist daily inventory snapshots. For a requested day, reconstruct the
opening balance from ledger history before the Tehran-day UTC range, sum
movements inside the range, and derive closing balance. The conceptual daily
fields are:

| Metric            | Ledger source                                |
| ----------------- | -------------------------------------------- |
| `openingStock`    | reconstructed pre-range `onHand` balance     |
| `received`        | `RECEIVE` on-hand delta                      |
| `shipped`         | `SHIP` on-hand delta                         |
| `returnedToStock` | `RETURN` positive on-hand delta              |
| `writeOff`        | `WRITE_OFF` negative on-hand delta           |
| `adjustment`      | `ADJUSTMENT` on-hand delta                   |
| `closingStock`    | opening balance plus in-range on-hand deltas |

Reservations change reserved/current availability, not physical on-hand
movement. Historical balances are initially reconstructed from durable ledger
history; ANL-04 must measure real query performance before any snapshot,
aggregation, or materialized-view design is considered.

## Price analytics

`PriceHistory` remains authoritative for actual price changes. Its committed
UTC timestamp is grouped by the Tehran business day when a daily grouping is
requested. Multiple changes on one day remain separate changes; they are not
collapsed into an invented daily price.

PRC-01 records changes after product creation and has no separate effective-at
dimension. The initial Product price is therefore not represented as a
PriceHistory event. Any later daily representation must explicitly distinguish
opening price, closing price, and change-series semantics rather than silently
filling this gap.

## ANL-02 product endpoints

The Admin product analytics routes are:

- `GET /api/v1/admin/analytics/products/:productId/stock`
- `GET /api/v1/admin/analytics/products/:productId/stock/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/admin/analytics/products/:productId/price-history?from=YYYY-MM-DD&to=YYYY-MM-DD`

All require `AccessTokenGuard`, `PermissionGuard`, and `ANALYTICS_READ`, and
set `Cache-Control: no-store`. Product metadata is limited to `id`, `name`, and
`isActive`; current Category is never joined as historical truth. Inactive
Products remain readable. A missing Product is `404 PRODUCT_NOT_FOUND`; a
missing Inventory row for an existing Product is an application invariant
failure and is never converted to zero.

Daily ranges are inclusive Tehran dates, capped at 366 days, and are converted
to `[startOfTehranDay, startOfNextTehranDay)`. Daily physical stock uses
`onHand` only. Reservations and releases do not change physical opening,
closing, received, shipped, return, write-off, or signed adjustment fields.
The implementation reconstructs each boundary as `current onHand - SUM(onHandDelta
where createdAt >= boundary)`, fetches the product's ledger once from the
requested start onward, and buckets the result in memory. Sparse days are
returned with equal opening/closing balances and zero movements.

Price history preserves every actual change in `(createdAt ASC, id ASC)` order.
The response exposes `currentPrice` as current state, an explicitly inferred
initial anchor at `Product.createdAt`, `priceAtRangeStart`, and only changes in
the requested half-open range. It does not insert a synthetic PriceHistory row.
Query-plan and index optimization remain ANL-04 responsibility.

## Today pulse, freshness, and scale

ANL-03 exposes sales overview, top products, and today pulse. Sales overview
uses independent lifecycle timestamps and deliveredAt for all sales fields;
`createdOrderValue` and `cancelledOrderValue` are separate immutable order
values. `cancelledOrderValue` is not lost revenue, a refund, or accounting
loss. `DELIVERED_VALUE` is `SUM(OrderLine.finalLineTotal)` before any invented
allocation of order-level discounts; it is not net sales.

Top products group by `productId`, rank by metric descending then productId
ascending, and select the latest qualifying historical `OrderLine.productName`
snapshot from the same event population. The name may therefore differ from
the current Product name. Today pulse uses the current Tehran day for event
metrics and also reports `awaitingReviewCurrent` as the request-time count of
all PENDING_REVIEW orders, regardless of creation date. Its return metric is
only `stockReturnedToStock`; no return or refund financial inference is made.

ANL-03 query counts are one Order aggregate plus one InventoryLedger aggregate
for today pulse, one aggregate for sales overview, and one aggregate for top
products. EXPLAIN and scale/index findings are intentionally deferred to
ANL-04.

Operational/current metrics (`awaitingReviewCurrent`, current stock,
reserved, available, and today pulse) are freshness-sensitive. Closed-period
historical analytics may be cached later. ANL-01 sets no hard-coded TTL; any
TTL must follow measured need.

Initial analytics remain bounded PostgreSQL reads over durable Order,
OrderLine, OrderReturn/OrderReturnLine, Inventory, InventoryLedger,
PriceHistory, and Product facts. No event duplication, warehouse,
Elasticsearch, predictive analytics, or unmeasured index/aggregation change is
approved. ANL-04 owns EXPLAIN-backed performance and index decisions.

Analytics does not define accounting, refund, credit, tax, or settlement
semantics. Adding those financial concepts requires an explicit architecture
decision and a review of the affected analytics contracts.
