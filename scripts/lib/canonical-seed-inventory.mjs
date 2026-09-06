export const CANONICAL_SEED_RECEIVE = Object.freeze({
  type: 'RECEIVE',
  quantity: 100,
  onHandDelta: 100,
  reservedDelta: 0,
  onHandAfter: 100,
  reservedAfter: 0,
  referenceType: 'RECEIVE',
  actorType: 'SYSTEM',
  actorId: null,
  correlationId: null,
});

export function assertCanonicalSeedInventoryState({
  productId,
  receiveId,
  inventory,
  ledger,
  reservations,
  orderLines,
}) {
  if (inventory === null) {
    if (ledger.length || reservations.length || orderLines.length) {
      throw contaminated(productId, 'related history exists without Inventory');
    }
    return 'CREATE';
  }

  if (
    ledger.length !== 1 ||
    ledger[0].id !== receiveId ||
    !matchesCanonicalLedger(ledger[0], receiveId)
  ) {
    throw contaminated(
      productId,
      'InventoryLedger is not the canonical seed event',
    );
  }
  if (inventory.onHand !== 100 || inventory.reserved !== 0) {
    throw contaminated(productId, 'Inventory aggregate is not 100/0');
  }
  if (reservations.length) {
    throw contaminated(productId, 'inventory reservations already exist');
  }
  if (orderLines.length) {
    throw contaminated(
      productId,
      'orders or order-linked history already exists',
    );
  }
  return 'IDEMPOTENT';
}

function matchesCanonicalLedger(row, receiveId) {
  return (
    Object.entries(CANONICAL_SEED_RECEIVE).every(([key, value]) =>
      key === 'referenceType' || key === 'actorType'
        ? row[key] === value
        : String(row[key]) === String(value),
    ) && row.referenceId === receiveId
  );
}

function contaminated(productId, reason) {
  return new Error(
    `Development seed refused product ${productId}: ${reason}. ` +
      'Use a fresh approved local database; seed never rewrites inventory history.',
  );
}
