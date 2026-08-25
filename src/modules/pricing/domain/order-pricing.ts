import { INVENTORY_INT4_MAX } from '../../inventory/domain/inventory-quantity';
import { DiscountTarget, type DiscountRecord } from './discount';
import {
  isLifetimeEligibleForLineWinner,
  resolveDiscountedQuantity,
} from './discount-lifetime-quantity';
import {
  assertDiscountMoneyAmount,
  calculateDiscount,
  computeDiscountAmount,
  computeLineBaseAmount,
  DiscountCalculationInvalidBaseAmountError,
  DiscountCalculationOverflowError,
  DiscountCalculationScope,
  filterEligibleDiscounts,
  selectWinningDiscount,
  toAppliedDiscountSnapshot,
  type AppliedDiscountSnapshot,
} from './discount-calculation';
import type { DiscountUsageConsumeIntent } from './discount-usage';
import {
  OrderPricingInvalidInputError,
  OrderPricingInvalidLineError,
  OrderPricingInvalidMoneyError,
} from './order-pricing-errors';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Trusted client/order-line identity only. Quantity is validated; price and
 * category authority come from server Product rows in the application layer.
 */
export interface OrderPricingLineInput {
  productId: string;
  quantity: number;
}

/** Server-authoritative product facts for one priced line. */
export interface OrderPricingProductContext {
  productId: string;
  productName: string;
  categoryId: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderPricingLineSnapshot {
  productId: string;
  productName: string;
  categoryId: string;
  unitPrice: number;
  quantity: number;
  /** Units that received the LINE discount (0…quantity). DLU-02. */
  discountedQuantity: number;
  grossLineTotal: bigint;
  lineDiscountAmount: bigint;
  finalLineTotal: bigint;
  appliedLineDiscount: AppliedDiscountSnapshot | null;
}

/**
 * Persistence-neutral pricing snapshot for ORD-03. Does not write Order rows.
 * Includes gross vs discounted amounts and applied-discount evidence so ORD-03
 * can persist without re-reading mutable Product/Discount state.
 */
export interface OrderPricingSnapshot {
  evaluatedAt: Date;
  lines: OrderPricingLineSnapshot[];
  grossSubtotal: bigint;
  lineDiscountTotal: bigint;
  subtotalAfterLineDiscounts: bigint;
  orderDiscountAmount: bigint;
  total: bigint;
  appliedOrderDiscount: AppliedDiscountSnapshot | null;
  /**
   * Capped PRODUCT LINE winners that must CONSUME usage on successful create.
   * Empty when no lifetime-capped PRODUCT discount won a line.
   */
  lifetimeConsumptions: DiscountUsageConsumeIntent[];
}

/**
 * Remaining eligible quantity by discountId for capped PRODUCT discounts.
 * `null` value means unlimited (should not appear for capped rows).
 * Missing key for a capped PRODUCT discount → that discount is LINE-ineligible.
 */
export type LifetimeRemainingByDiscountId = ReadonlyMap<string, number>;

export interface ComposeOrderPricingInput {
  evaluatedAt: Date;
  lines: readonly OrderPricingProductContext[];
  discounts: readonly DiscountRecord[];
  /**
   * Locked remaining entitlement for capped PRODUCT discounts (DLU-02).
   * When omitted, lifetime caps are not applied (standalone/preview pricing).
   * When provided (even empty), capped PRODUCT discounts missing from the map
   * are LINE-ineligible.
   */
  lifetimeRemainingByDiscountId?: LifetimeRemainingByDiscountId;
}

/**
 * Collapse duplicate productId lines by summing quantities (ORD-01 / Inventory
 * V1 normalization). Rejects empty input and invalid ids/quantities.
 */
export function normalizeOrderPricingLineInputs(
  lines: readonly OrderPricingLineInput[],
): OrderPricingLineInput[] {
  if (lines.length === 0) {
    throw new OrderPricingInvalidInputError(
      'Order pricing requires at least one line.',
    );
  }

  const byProduct = new Map<string, number>();

  for (const line of lines) {
    const productId = assertOrderPricingProductId(line.productId);
    const quantity = assertOrderPricingQuantity(line.quantity);
    const existing = byProduct.get(productId);
    if (existing === undefined) {
      byProduct.set(productId, quantity);
      continue;
    }

    const merged = existing + quantity;
    assertOrderPricingQuantity(merged);
    byProduct.set(productId, merged);
  }

  return [...byProduct.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

/**
 * V1 composition (ADR 0015 / instructions/pricing.md):
 * 1. At most one LINE winner per line (PRODUCT/CATEGORY), with DLU-02 partial qty
 * 2. Sum final line totals → subtotalAfterLineDiscounts
 * 3. At most one ORDER winner against that subtotal
 * Reuses PRC-03 discount math — does not fork percent/fixed/precedence rules.
 */
export function composeOrderPricing(
  input: ComposeOrderPricingInput,
): OrderPricingSnapshot {
  if (
    !(input.evaluatedAt instanceof Date) ||
    Number.isNaN(input.evaluatedAt.getTime())
  ) {
    throw new OrderPricingInvalidInputError(
      'Order pricing requires a valid evaluatedAt instant.',
    );
  }
  if (input.lines.length === 0) {
    throw new OrderPricingInvalidInputError(
      'Order pricing requires at least one priced line.',
    );
  }

  const applyLifetimeLimits = input.lifetimeRemainingByDiscountId !== undefined;
  const lifetimeRemaining =
    input.lifetimeRemainingByDiscountId ?? new Map<string, number>();

  const lineSnapshots: OrderPricingLineSnapshot[] = [];
  let grossSubtotal = 0n;
  let subtotalAfterLineDiscounts = 0n;
  const lifetimeConsumptions: DiscountUsageConsumeIntent[] = [];

  for (const line of input.lines) {
    const priced = priceSingleLine(
      line,
      input.discounts,
      input.evaluatedAt,
      applyLifetimeLimits ? lifetimeRemaining : null,
    );
    lineSnapshots.push(priced);
    grossSubtotal = addMoney(
      grossSubtotal,
      priced.grossLineTotal,
      'grossSubtotal',
    );
    subtotalAfterLineDiscounts = addMoney(
      subtotalAfterLineDiscounts,
      priced.finalLineTotal,
      'subtotalAfterLineDiscounts',
    );

    const consumption = lifetimeConsumeIntentForLine(
      priced,
      input.discounts,
      applyLifetimeLimits,
    );
    if (consumption !== null) {
      lifetimeConsumptions.push(consumption);
    }
  }

  const lineDiscountTotal = assertMoney(
    grossSubtotal - subtotalAfterLineDiscounts,
    'lineDiscountTotal',
  );

  let orderResult: ReturnType<typeof calculateDiscount>;
  try {
    orderResult = calculateDiscount({
      baseAmount: subtotalAfterLineDiscounts,
      scope: DiscountCalculationScope.ORDER,
      discounts: input.discounts,
      evaluatedAt: input.evaluatedAt,
    });
  } catch (error: unknown) {
    throw mapCalculationError(error);
  }

  return {
    evaluatedAt: input.evaluatedAt,
    lines: lineSnapshots,
    grossSubtotal,
    lineDiscountTotal,
    subtotalAfterLineDiscounts,
    orderDiscountAmount: orderResult.discountAmount,
    total: orderResult.finalAmount,
    appliedOrderDiscount: orderResult.appliedDiscount,
    lifetimeConsumptions,
  };
}

function priceSingleLine(
  line: OrderPricingProductContext,
  discounts: readonly DiscountRecord[],
  evaluatedAt: Date,
  lifetimeRemaining: LifetimeRemainingByDiscountId | null,
): OrderPricingLineSnapshot {
  try {
    const grossLineTotal = computeLineBaseAmount({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    });

    const lineContext = {
      productId: line.productId,
      categoryId: line.categoryId,
    };

    let eligible = filterEligibleDiscounts({
      scope: DiscountCalculationScope.LINE,
      lineContext,
      discounts,
      evaluatedAt,
    });
    if (lifetimeRemaining !== null) {
      eligible = eligible.filter((discount) =>
        isLifetimeEligibleForLineWinner(
          discount,
          lifetimeRemaining.get(discount.id),
        ),
      );
    }

    const winner = selectWinningDiscount(eligible);
    if (winner === null) {
      return {
        productId: line.productId,
        productName: line.productName,
        categoryId: line.categoryId,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discountedQuantity: 0,
        grossLineTotal,
        lineDiscountAmount: 0n,
        finalLineTotal: grossLineTotal,
        appliedLineDiscount: null,
      };
    }

    let discountedQuantity = line.quantity;
    if (lifetimeRemaining !== null && winner.maxQuantityPerCustomer !== null) {
      discountedQuantity = resolveDiscountedQuantity({
        requestedQuantity: line.quantity,
        remainingEligibleQuantity: lifetimeRemaining.get(winner.id) ?? 0,
      });
    }

    if (discountedQuantity === 0) {
      // Exhausted capped PRODUCT should already be filtered; defense in depth.
      return {
        productId: line.productId,
        productName: line.productName,
        categoryId: line.categoryId,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discountedQuantity: 0,
        grossLineTotal,
        lineDiscountAmount: 0n,
        finalLineTotal: grossLineTotal,
        appliedLineDiscount: null,
      };
    }

    const discountBase = computeLineBaseAmount({
      unitPrice: line.unitPrice,
      quantity: discountedQuantity,
    });
    const lineDiscountAmount = computeDiscountAmount(winner, discountBase);
    const finalLineTotal = assertMoney(
      grossLineTotal - lineDiscountAmount,
      'finalLineTotal',
    );

    return {
      productId: line.productId,
      productName: line.productName,
      categoryId: line.categoryId,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountedQuantity,
      grossLineTotal,
      lineDiscountAmount,
      finalLineTotal,
      appliedLineDiscount: toAppliedDiscountSnapshot(winner),
    };
  } catch (error: unknown) {
    throw mapCalculationError(error);
  }
}

function lifetimeConsumeIntentForLine(
  line: OrderPricingLineSnapshot,
  discounts: readonly DiscountRecord[],
  applyLifetimeLimits: boolean,
): DiscountUsageConsumeIntent | null {
  if (!applyLifetimeLimits) {
    return null;
  }
  const applied = line.appliedLineDiscount;
  if (applied === null || line.discountedQuantity < 1) {
    return null;
  }
  const definition = discounts.find(
    (discount) => discount.id === applied.discountId,
  );
  if (
    definition === undefined ||
    definition.maxQuantityPerCustomer === null ||
    applied.target !== DiscountTarget.PRODUCT
  ) {
    return null;
  }
  return {
    discountId: applied.discountId,
    quantity: line.discountedQuantity,
  };
}

function addMoney(left: bigint, right: bigint, field: string): bigint {
  return assertMoney(left + right, field);
}

function assertMoney(raw: bigint, field: string): bigint {
  try {
    return assertDiscountMoneyAmount(raw, field);
  } catch (error: unknown) {
    throw mapCalculationError(error);
  }
}

function mapCalculationError(error: unknown): Error {
  if (
    error instanceof DiscountCalculationInvalidBaseAmountError ||
    error instanceof DiscountCalculationOverflowError
  ) {
    return new OrderPricingInvalidMoneyError(error.message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new OrderPricingInvalidMoneyError('Order pricing calculation failed.');
}

function assertOrderPricingProductId(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
    throw new OrderPricingInvalidLineError(
      'Order pricing productId must be a UUID.',
    );
  }
  return raw.toLowerCase();
}

function assertOrderPricingQuantity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new OrderPricingInvalidLineError(
      'Order pricing quantity must be a whole number of sellable units.',
    );
  }
  if (raw < 1 || raw > INVENTORY_INT4_MAX) {
    throw new OrderPricingInvalidLineError(
      `Order pricing quantity must be between 1 and ${INVENTORY_INT4_MAX}.`,
    );
  }
  return raw;
}
