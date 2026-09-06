import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  assertCanonicalSeedInventoryState,
  CANONICAL_SEED_RECEIVE,
} from './canonical-seed-inventory.mjs';

const PRODUCT = '00000000-0000-4000-8000-000000000201';
const RECEIVE = '00000000-0000-4000-8000-000000000301';
const canonical = {
  id: RECEIVE,
  ...CANONICAL_SEED_RECEIVE,
  referenceId: RECEIVE,
};
const input = (overrides = {}) => ({
  productId: PRODUCT,
  receiveId: RECEIVE,
  inventory: null,
  ledger: [],
  reservations: [],
  orderLines: [],
  ...overrides,
});

describe('canonical development seed inventory guard', () => {
  it('allows the clean 0/0 baseline to be created', () => {
    assert.equal(assertCanonicalSeedInventoryState(input()), 'CREATE');
  });
  it('allows an exact canonical rerun without mutation', () => {
    assert.equal(
      assertCanonicalSeedInventoryState(
        input({ inventory: { onHand: 100, reserved: 0 }, ledger: [canonical] }),
      ),
      'IDEMPOTENT',
    );
  });
  it('rejects existing Inventory without canonical provenance', () => {
    assert.throws(() =>
      assertCanonicalSeedInventoryState(
        input({ inventory: { onHand: 100, reserved: 0 } }),
      ),
    );
  });
  it('rejects conflicting reservation, order, or ledger history', () => {
    for (const overrides of [
      { reservations: [{ id: 'reservation' }] },
      { orderLines: [{ id: 'line' }] },
      { ledger: [{ ...canonical, quantity: 101 }] },
    ])
      assert.throws(() => assertCanonicalSeedInventoryState(input(overrides)));
  });
  it('describes a reconciliation-valid canonical ledger transition', () => {
    assert.equal(canonical.onHandAfter, 0 + canonical.onHandDelta);
    assert.equal(canonical.reservedAfter, 0 + canonical.reservedDelta);
  });
});
