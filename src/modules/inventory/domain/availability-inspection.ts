export interface AvailabilityShortage {
  productId: string;
  requested: number;
  available: number;
}

export interface AvailabilityInspection {
  missingProductIds: string[];
  shortages: AvailabilityShortage[];
}

export function inspectAvailability(input: {
  requested: ReadonlyArray<{ productId: string; quantity: number }>;
  locked: ReadonlyArray<{ productId: string; available: number }>;
}): AvailabilityInspection {
  const lockedById = new Map(
    input.locked.map((row) => [row.productId, row.available]),
  );
  const missingProductIds: string[] = [];
  const shortages: AvailabilityShortage[] = [];

  for (const item of input.requested) {
    const available = lockedById.get(item.productId);
    if (available === undefined) {
      missingProductIds.push(item.productId);
      continue;
    }
    if (available < item.quantity) {
      shortages.push({
        productId: item.productId,
        requested: item.quantity,
        available,
      });
    }
  }

  return { missingProductIds, shortages };
}
