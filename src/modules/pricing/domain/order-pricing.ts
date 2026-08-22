import { INVENTORY_INT4_MAX } from '../../inventory/domain/inventory-quantity';
import type { DiscountRecord } from './discount';
import {
  assertDiscountMoneyAmount,
  calculateDiscount,
  computeLineBaseAmount,
  DiscountCalculationInvalidBaseAmountError,
  DiscountCalculationOverflowError,
  DiscountCalculationScope,
  type AppliedDiscountSnapshot,
} from './discount-calculation';
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
}

export interface ComposeOrderPricingInput {
  evaluatedAt: Date;
  lines: readonly OrderPricingProductContext[];
  discounts: readonly DiscountRecord[];
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
 * 1. At most one LINE winner per line (PRODUCT/CATEGORY)
 * 2. Sum final line totals → subtotalAfterLineDiscounts
 * 3. At most one ORDER winner against that subtotal
 * Reuses PRC-03 `calculateDiscount` — does not fork discount math.
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

  const lineSnapshots: OrderPricingLineSnapshot[] = [];
  let grossSubtotal = 0n;
  let subtotalAfterLineDiscounts = 0n;

  for (const line of input.lines) {
    const priced = priceSingleLine(line, input.discounts, input.evaluatedAt);
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
  };
}

function priceSingleLine(
  line: OrderPricingProductContext,
  discounts: readonly DiscountRecord[],
  evaluatedAt: Date,
): OrderPricingLineSnapshot {
  try {
    const grossLineTotal = computeLineBaseAmount({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    });

    const lineResult = calculateDiscount({
      baseAmount: grossLineTotal,
      scope: DiscountCalculationScope.LINE,
      lineContext: {
        productId: line.productId,
        categoryId: line.categoryId,
      },
      discounts,
      evaluatedAt,
    });

    return {
      productId: line.productId,
      productName: line.productName,
      categoryId: line.categoryId,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      grossLineTotal,
      lineDiscountAmount: lineResult.discountAmount,
      finalLineTotal: lineResult.finalAmount,
      appliedLineDiscount: lineResult.appliedDiscount,
    };
  } catch (error: unknown) {
    throw mapCalculationError(error);
  }
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
