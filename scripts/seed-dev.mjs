import 'dotenv/config';
import pg from 'pg';
import { parseApprovedDevelopmentDatabase } from './lib/dev-seed-safety.mjs';
import { assertCanonicalSeedInventoryState } from './lib/canonical-seed-inventory.mjs';

const { Client } = pg;
const ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const REGION_ID = '00000000-0000-4000-8000-000000000010';
const categories = [
  { id: '00000000-0000-4000-8000-000000000101', name: 'Eggs & Breakfast' },
  { id: '00000000-0000-4000-8000-000000000102', name: 'Dairy & Chilled' },
  { id: '00000000-0000-4000-8000-000000000103', name: 'Pantry Essentials' },
];
const products = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    name: 'Farm Fresh Development Eggs 12-pack',
    price: 185000,
    categoryId: categories[0].id,
    receiveId: '00000000-0000-4000-8000-000000000301',
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    name: 'Local Dairy Development Milk 1L',
    price: 95000,
    categoryId: categories[1].id,
    receiveId: '00000000-0000-4000-8000-000000000302',
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    name: 'Development Pantry Rice 1kg',
    price: 245000,
    categoryId: categories[2].id,
    receiveId: '00000000-0000-4000-8000-000000000303',
  },
];
const STOCK_PER_PRODUCT = 100;

function assertExisting(row, expected, label) {
  if (row === undefined)
    throw new Error(`${label} was not returned after seeding.`);
  for (const [key, value] of Object.entries(expected)) {
    if (String(row[key]) !== String(value))
      throw new Error(
        `${label} ${key} differs from the canonical development fixture.`,
      );
  }
}

async function seed() {
  const target = parseApprovedDevelopmentDatabase();
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "Admin" ("id", "email", "passwordHash", "role", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'WAREHOUSE', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
      [
        ACTOR_ID,
        'seed-actor@localhost.test',
        '$argon2id$eggship-development-seed-actor-disabled',
      ],
    );
    const actor = (
      await client.query(
        'SELECT "email", "role", "isActive" FROM "Admin" WHERE "id" = $1',
        [ACTOR_ID],
      )
    ).rows[0];
    assertExisting(
      actor,
      {
        email: 'seed-actor@localhost.test',
        role: 'WAREHOUSE',
        isActive: false,
      },
      'Seed actor',
    );

    for (const category of categories) {
      await client.query(
        `INSERT INTO "Category" ("id", "name", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
        [category.id, category.name],
      );
      const row = (
        await client.query(
          'SELECT "name", "isActive" FROM "Category" WHERE "id" = $1',
          [category.id],
        )
      ).rows[0];
      assertExisting(
        row,
        { name: category.name, isActive: true },
        `Category ${category.id}`,
      );
    }

    await client.query(
      `INSERT INTO "Region" ("id", "name", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
      [REGION_ID, 'Tehran Development Delivery Region'],
    );
    const region = (
      await client.query(
        'SELECT "name", "isActive" FROM "Region" WHERE "id" = $1',
        [REGION_ID],
      )
    ).rows[0];
    assertExisting(
      region,
      { name: 'Tehran Development Delivery Region', isActive: true },
      'Region',
    );

    for (const product of products) {
      await client.query(
        `INSERT INTO "Product" ("id", "name", "price", "categoryId", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
        [product.id, product.name, product.price, product.categoryId],
      );
      const current = (
        await client.query(
          'SELECT "name", "price", "categoryId", "isActive" FROM "Product" WHERE "id" = $1',
          [product.id],
        )
      ).rows[0];
      assertExisting(
        current,
        {
          name: product.name,
          price: product.price,
          categoryId: product.categoryId,
          isActive: true,
        },
        `Product ${product.id}`,
      );
      const inventory =
        (
          await client.query(
            'SELECT "productId", "onHand", "reserved" FROM "Inventory" WHERE "productId" = $1',
            [product.id],
          )
        ).rows[0] ?? null;
      const ledger = (
        await client.query(
          'SELECT "id", "type", "quantity", "onHandDelta", "reservedDelta", "onHandAfter", "reservedAfter", "referenceType", "referenceId", "actorType", "actorId", "correlationId" FROM "InventoryLedger" WHERE "productId" = $1 ORDER BY "createdAt", "id"',
          [product.id],
        )
      ).rows;
      const reservations = (
        await client.query(
          'SELECT "id" FROM "InventoryReservation" WHERE "productId" = $1',
          [product.id],
        )
      ).rows;
      const orderLines = (
        await client.query(
          'SELECT ol."id" FROM "OrderLine" ol WHERE ol."productId" = $1',
          [product.id],
        )
      ).rows;
      const state = assertCanonicalSeedInventoryState({
        productId: product.id,
        receiveId: product.receiveId,
        inventory,
        ledger,
        reservations,
        orderLines,
      });
      if (state === 'CREATE') {
        await client.query(
          `INSERT INTO "Inventory" ("productId", "onHand", "reserved", "createdAt", "updatedAt") VALUES ($1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [product.id],
        );
        const balance = (
          await client.query(
            `UPDATE "Inventory" SET "onHand" = "onHand" + $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "productId" = $1 RETURNING "onHand", "reserved"`,
            [product.id, STOCK_PER_PRODUCT],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO "InventoryLedger" ("id", "productId", "type", "quantity", "onHandDelta", "reservedDelta", "onHandAfter", "reservedAfter", "referenceType", "referenceId", "reason", "actorType") VALUES ($1, $2, 'RECEIVE', $3, $3, 0, $4, $5, 'RECEIVE', $1, 'EggShip development seed stock', 'SYSTEM')`,
          [
            product.receiveId,
            product.id,
            STOCK_PER_PRODUCT,
            balance.onHand,
            balance.reserved,
          ],
        );
      } else if (state !== 'IDEMPOTENT') {
        throw new Error(`Unexpected canonical seed state for ${product.id}.`);
      }
    }

    await client.query(
      `INSERT INTO "CommerceSettings" ("id", "orderingScheduleEnabled", "orderingOpensAtLocalMinute", "orderingClosesAtLocalMinute", "minimumOrderQuantity", "revision", "createdByAdminId", "updatedByAdminId", "createdAt", "updatedAt") VALUES (1, false, 0, 1439, 1, 1, $1, $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
      [ACTOR_ID],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  const summaryClient = new Client({
    connectionString: target.connectionString,
  });
  await summaryClient.connect();
  try {
    const result = await summaryClient.query(
      `SELECT (SELECT count(*)::int FROM "Category" WHERE "id" = ANY($1::uuid[])) AS "categoryCount", (SELECT count(*)::int FROM "Product" WHERE "id" = ANY($2::uuid[])) AS "productCount", (SELECT count(*)::int FROM "Region" WHERE "id" = $3::uuid) AS "regionCount", (SELECT json_agg(json_build_object('id', p."id", 'priceToman', p."price", 'available', i."onHand" - i."reserved") ORDER BY p."id") FROM "Product" p JOIN "Inventory" i ON i."productId" = p."id" WHERE p."id" = ANY($2::uuid[])) AS "products"`,
      [categories.map(({ id }) => id), products.map(({ id }) => id), REGION_ID],
    );
    const row = result.rows[0];
    console.log(
      JSON.stringify(
        {
          target: target.displayTarget,
          categoryCount: row.categoryCount,
          productCount: row.productCount,
          regionCount: row.regionCount,
          seededProductIds: products.map(({ id }) => id),
          seededRegionId: REGION_ID,
          currentPricesAndAvailableInventory: row.products,
        },
        null,
        2,
      ),
    );
  } finally {
    await summaryClient.end();
  }
}

seed().catch((error) => {
  console.error(
    `Development seed failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
