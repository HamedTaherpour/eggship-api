# Local development seed

Run the canonical fixture with:

```bash
NODE_ENV=development pnpm db:seed:dev
```

PostgreSQL must be running locally, the database must be named `eggship`, and
`.env` must contain its development `DATABASE_URL`. Apply migrations first with
`pnpm prisma:migrate:dev` when needed.

The seed is deterministic, idempotent, and does not reset, drop, truncate, or
modify unrelated rows. It creates three active categories, one active Tehran
development region, three active products with integer-Toman prices, 100 units
of stock per product, one append-only `RECEIVE` ledger event per product, and
the commerce singleton when absent (schedule disabled, minimum quantity 1,
revision 1). It creates no customers, usable admin credentials, orders,
discounts, or media.

Commerce foreign keys require one deterministic inactive synthetic Admin row,
`seed-actor@localhost.test`, as provenance for the local settings. Its password hash
is unusable and it cannot authenticate.

The guard accepts only `NODE_ENV=development`, PostgreSQL, a loopback host
(`localhost`, `127.0.0.1`, or `::1`), and database name exactly `eggship`; it
fails before connecting for production, staging, test, remote, or unknown
targets. The command prints product/region IDs, prices, and available stock.

Use the printed values for REL-03. The fixed IDs are also:

```bash
export LOAD_TEST_PRODUCT_IDS=00000000-0000-4000-8000-000000000201,00000000-0000-4000-8000-000000000202,00000000-0000-4000-8000-000000000203
export LOAD_TEST_REGION_ID=00000000-0000-4000-8000-000000000010
```

Create the synthetic customer's order through the real Orders API before
running `pnpm load:order-reads`; no historical orders are seeded.
