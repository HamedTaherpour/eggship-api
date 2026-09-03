import { OrderStatus } from './order-status';

/**
 * V1 Admin Dispatch board statuses (ADR 0024). Not a workflow state —
 * operational pipeline only.
 */
export const DISPATCH_PIPELINE_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
] as const;

export type DispatchPipelineStatus =
  (typeof DISPATCH_PIPELINE_STATUSES)[number];

/**
 * Conservative V1 bound for the grouped dispatch read model.
 * Aligned with CAT-01 `MAX_PAGE_SIZE` so the board stays explicitly bounded
 * without inventing a large operational dump.
 */
export const ADMIN_DISPATCH_ORDER_LIMIT = 100;

export interface AdminDispatchQuery {
  regionId?: string;
  /** Optional narrow filter within the approved dispatch pipeline. */
  status?: DispatchPipelineStatus;
}

/** Flat repository row before Region grouping. */
export interface AdminDispatchOrderRecord {
  id: string;
  status: DispatchPipelineStatus;
  customerPhone: string;
  regionId: string;
  regionName: string;
  total: bigint;
  /** Efficient `_count.lines` — no line payloads. */
  lineCount: number;
  deliveryAt: Date | null;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  createdAt: Date;
}

export interface AdminDispatchRegionGroup {
  region: { id: string; name: string };
  ordersCount: number;
  orders: AdminDispatchOrderRecord[];
}

export interface AdminDispatchSummary {
  /** Orders present in this response (after the bound). */
  ordersCount: number;
  confirmedCount: number;
  shippedCount: number;
  regionCount: number;
  /** Implementation bound (`ADMIN_DISPATCH_ORDER_LIMIT`). */
  limit: number;
  /** True when matchedCount exceeds the returned bound. */
  truncated: boolean;
  /** Full population matching filters before the bound. */
  matchedCount: number;
}

export interface AdminDispatchBoard {
  summary: AdminDispatchSummary;
  groups: AdminDispatchRegionGroup[];
}

export function isDispatchPipelineStatus(
  value: unknown,
): value is DispatchPipelineStatus {
  return value === OrderStatus.CONFIRMED || value === OrderStatus.SHIPPED;
}

/**
 * Within-group / global order: deliveryAt ASC (nulls last), createdAt ASC, id ASC.
 * Null deliveryAt is treated as after every concrete timestamp.
 */
export function compareDispatchOrders(
  a: AdminDispatchOrderRecord,
  b: AdminDispatchOrderRecord,
): number {
  const deliveryCmp = compareNullableDateAscNullsLast(
    a.deliveryAt,
    b.deliveryAt,
  );
  if (deliveryCmp !== 0) return deliveryCmp;
  const createdCmp = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdCmp !== 0) return createdCmp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareNullableDateAscNullsLast(
  a: Date | null,
  b: Date | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}

/**
 * Groups flat dispatch rows by Order snapshot regionId/regionName.
 * Groups ordered by regionName ASC, then regionId ASC.
 * Orders within each group use {@link compareDispatchOrders}.
 */
export function buildAdminDispatchBoard(
  items: readonly AdminDispatchOrderRecord[],
  matchedCount: number,
  limit: number = ADMIN_DISPATCH_ORDER_LIMIT,
): AdminDispatchBoard {
  const byRegion = new Map<string, AdminDispatchOrderRecord[]>();
  for (const item of items) {
    const bucket = byRegion.get(item.regionId);
    if (bucket === undefined) {
      byRegion.set(item.regionId, [item]);
    } else {
      bucket.push(item);
    }
  }

  const groups: AdminDispatchRegionGroup[] = [...byRegion.entries()]
    .map(([regionId, orders]) => {
      const sorted = [...orders].sort(compareDispatchOrders);
      const name = sorted[0]!.regionName;
      return {
        region: { id: regionId, name },
        ordersCount: sorted.length,
        orders: sorted,
      };
    })
    .sort((a, b) => {
      const nameCmp = a.region.name.localeCompare(b.region.name);
      if (nameCmp !== 0) return nameCmp;
      return a.region.id < b.region.id ? -1 : a.region.id > b.region.id ? 1 : 0;
    });

  let confirmedCount = 0;
  let shippedCount = 0;
  for (const item of items) {
    if (item.status === OrderStatus.CONFIRMED) confirmedCount += 1;
    else if (item.status === OrderStatus.SHIPPED) shippedCount += 1;
  }

  return {
    summary: {
      ordersCount: items.length,
      confirmedCount,
      shippedCount,
      regionCount: groups.length,
      limit,
      truncated: matchedCount > items.length,
      matchedCount,
    },
    groups,
  };
}
