import { DiscountTarget, DiscountType, type DiscountRecord } from './discount';
import { isPotentiallyApplicable } from './discount-lifecycle';
import { normalizeDiscountTargetScope } from './discount-target';
import { normalizeDiscountTypeValues } from './discount-value';

/**
 * PostgreSQL BIGINT upper bound for discount calculation amounts.
 * Same value as order money (ADR 0013) — kept local to avoid pricing↔orders import cycle before PRC-05.
 */
export const DISCOUNT_MONEY_MAX_TOMAN = 9_223_372_036_854_775_807n;

/**
 * Where discount target matching runs. LINE evaluates PRODUCT and CATEGORY
 * discounts against server-authoritative line context; ORDER evaluates ORDER
 * discounts against an order subtotal base.
 */
export const DiscountCalculationScope = {
  LINE: 'LINE',
  ORDER: 'ORDER',
} as const;

export type DiscountCalculationScope =
  (typeof DiscountCalculationScope)[keyof typeof DiscountCalculationScope];

/** Server-authoritative pricing inputs for one calculation invocation. */
export interface DiscountPricingLineContext {
  /** Product id from catalog — never client-supplied price authority. */
  productId: string;
  /** Category id from Product.categoryId — server authoritative. */
  categoryId: string;
  /** Integer Toman unit price from Product.price. */
  unitPrice: number;
  quantity: number;
}

export interface DiscountCalculationInput {
  /** Integer Toman amount before discount (line total or order subtotal). */
  baseAmount: bigint;
  scope: DiscountCalculationScope;
  /** Required when scope is LINE — used for PRODUCT/CATEGORY target matching. */
  lineContext?: Pick<DiscountPricingLineContext, 'productId' | 'categoryId'>;
  /** Candidate discounts (typically loaded elsewhere; no DB access here). */
  discounts: readonly DiscountRecord[];
  /** UTC instant for eligibility window evaluation — explicit snapshot contract. */
  evaluatedAt: Date;
}

/** Immutable discount evidence suitable for future Order snapshotting (ORD-03). */
export interface AppliedDiscountSnapshot {
  discountId: string;
  name: string;
  type: DiscountType;
  target: DiscountTarget;
  percentValue: number | null;
  fixedAmount: number | null;
  precedence: number;
  productId: string | null;
  categoryId: string | null;
}

export interface DiscountCalculationResult {
  baseAmount: bigint;
  discountAmount: bigint;
  finalAmount: bigint;
  appliedDiscount: AppliedDiscountSnapshot | null;
  /** Echo of the evaluation instant from input — supports audit/snapshot correlation. */
  evaluatedAt: Date;
}

/**
 * V1 stacking rule: exactly one winning discount per calculation invocation.
 * Higher `precedence` wins; equal precedence breaks on ascending discount `id`.
 */
export function compareDiscountWinner(
  left: DiscountRecord,
  right: DiscountRecord,
): number {
  if (left.precedence !== right.precedence) {
    return right.precedence - left.precedence;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

/** Whether a discount target matches the calculation scope and line context. */
export function isDiscountTargetCompatible(
  discount: Pick<DiscountRecord, 'target' | 'productId' | 'categoryId'>,
  scope: DiscountCalculationScope,
  lineContext?: Pick<DiscountPricingLineContext, 'productId' | 'categoryId'>,
): boolean {
  switch (discount.target) {
    case DiscountTarget.ORDER:
      return scope === DiscountCalculationScope.ORDER;
    case DiscountTarget.PRODUCT:
      return (
        scope === DiscountCalculationScope.LINE &&
        lineContext !== undefined &&
        discount.productId === lineContext.productId
      );
    case DiscountTarget.CATEGORY:
      return (
        scope === DiscountCalculationScope.LINE &&
        lineContext !== undefined &&
        discount.categoryId === lineContext.categoryId
      );
    default: {
      const exhaustive: never = discount.target;
      return exhaustive;
    }
  }
}

/** Skip persisted rows that bypassed validation — calculation must not throw. */
export function isDiscountCalculable(discount: DiscountRecord): boolean {
  try {
    normalizeDiscountTypeValues({
      type: discount.type,
      percentValue: discount.percentValue,
      fixedAmount: discount.fixedAmount,
    });
    normalizeDiscountTargetScope({
      target: discount.target,
      productId: discount.productId,
      categoryId: discount.categoryId,
    });
    return true;
  } catch {
    return false;
  }
}

export function assertDiscountBaseAmount(raw: unknown): bigint {
  if (typeof raw !== 'bigint') {
    throw new DiscountCalculationInvalidBaseAmountError(
      'Discount base amount must be a bigint integer number of Toman.',
    );
  }
  if (raw < 0n || raw > DISCOUNT_MONEY_MAX_TOMAN) {
    throw new DiscountCalculationInvalidBaseAmountError(
      `Discount base amount must be between 0 and ${DISCOUNT_MONEY_MAX_TOMAN} Toman.`,
    );
  }
  return raw;
}

/**
 * Percent discount amount: floor(base × percent / 100) using bigint arithmetic.
 * Integer division truncates toward zero — the approved V1 rounding rule.
 */
export function computePercentDiscountAmount(
  baseAmount: bigint,
  percentValue: number,
): bigint {
  assertDiscountBaseAmount(baseAmount);
  const amount = (baseAmount * BigInt(percentValue)) / 100n;
  assertDiscountMoneyAmount(amount, 'discountAmount');
  return amount;
}

/** Fixed discount capped at the applicable base — final payable cannot go negative. */
export function computeFixedDiscountAmount(
  baseAmount: bigint,
  fixedAmount: number,
): bigint {
  assertDiscountBaseAmount(baseAmount);
  const fixed = BigInt(fixedAmount);
  const amount = fixed <= baseAmount ? fixed : baseAmount;
  assertDiscountMoneyAmount(amount, 'discountAmount');
  return amount;
}

export function computeDiscountAmount(
  discount: Pick<DiscountRecord, 'type' | 'percentValue' | 'fixedAmount'>,
  baseAmount: bigint,
): bigint {
  if (discount.type === DiscountType.PERCENT) {
    if (discount.percentValue === null) {
      throw new DiscountCalculationInvalidDiscountError(
        'PERCENT discount is missing percentValue.',
      );
    }
    return computePercentDiscountAmount(baseAmount, discount.percentValue);
  }

  if (discount.fixedAmount === null) {
    throw new DiscountCalculationInvalidDiscountError(
      'FIXED discount is missing fixedAmount.',
    );
  }
  return computeFixedDiscountAmount(baseAmount, discount.fixedAmount);
}

export function selectWinningDiscount(
  candidates: readonly DiscountRecord[],
): DiscountRecord | null {
  if (candidates.length === 0) {
    return null;
  }

  let winner: DiscountRecord = candidates[0]!;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (compareDiscountWinner(candidate, winner) < 0) {
      winner = candidate;
    }
  }
  return winner;
}

export function filterEligibleDiscounts(
  input: Pick<
    DiscountCalculationInput,
    'scope' | 'lineContext' | 'discounts' | 'evaluatedAt'
  >,
): DiscountRecord[] {
  if (
    input.scope === DiscountCalculationScope.LINE &&
    input.lineContext === undefined
  ) {
    throw new DiscountCalculationInvalidContextError(
      'LINE scope requires server-authoritative lineContext.',
    );
  }

  return input.discounts.filter(
    (discount) =>
      isPotentiallyApplicable(discount, input.evaluatedAt) &&
      isDiscountTargetCompatible(discount, input.scope, input.lineContext) &&
      isDiscountCalculable(discount),
  );
}

export function toAppliedDiscountSnapshot(
  discount: DiscountRecord,
): AppliedDiscountSnapshot {
  return {
    discountId: discount.id,
    name: discount.name,
    type: discount.type,
    target: discount.target,
    percentValue: discount.percentValue,
    fixedAmount: discount.fixedAmount,
    precedence: discount.precedence,
    productId: discount.productId,
    categoryId: discount.categoryId,
  };
}

/**
 * Pure, persistence-neutral discount calculation (PRC-03).
 * Callers supply discounts and a pricing snapshot instant; no DB mutation.
 */
export function calculateDiscount(
  input: DiscountCalculationInput,
): DiscountCalculationResult {
  const baseAmount = assertDiscountBaseAmount(input.baseAmount);
  const eligible = filterEligibleDiscounts(input);
  const winner = selectWinningDiscount(eligible);

  if (winner === null) {
    return {
      baseAmount,
      discountAmount: 0n,
      finalAmount: baseAmount,
      appliedDiscount: null,
      evaluatedAt: input.evaluatedAt,
    };
  }

  const discountAmount = computeDiscountAmount(winner, baseAmount);
  const finalAmount = baseAmount - discountAmount;

  return {
    baseAmount,
    discountAmount,
    finalAmount,
    appliedDiscount: toAppliedDiscountSnapshot(winner),
    evaluatedAt: input.evaluatedAt,
  };
}

export function assertDiscountMoneyAmount(
  raw: bigint,
  field = 'amount',
): bigint {
  if (raw < 0n || raw > DISCOUNT_MONEY_MAX_TOMAN) {
    throw new DiscountCalculationOverflowError(
      `${field} exceeds supported integer Toman bounds.`,
    );
  }
  return raw;
}

/** Build line base amount from server-authoritative unit price and quantity. */
export function computeLineBaseAmount(
  line: Pick<DiscountPricingLineContext, 'unitPrice' | 'quantity'>,
): bigint {
  if (
    typeof line.unitPrice !== 'number' ||
    !Number.isInteger(line.unitPrice) ||
    line.unitPrice < 1
  ) {
    throw new DiscountCalculationInvalidBaseAmountError(
      'Line unit price must be a positive integer Toman.',
    );
  }
  if (
    typeof line.quantity !== 'number' ||
    !Number.isInteger(line.quantity) ||
    line.quantity < 1
  ) {
    throw new DiscountCalculationInvalidBaseAmountError(
      'Line quantity must be a positive integer.',
    );
  }

  const baseAmount = BigInt(line.unitPrice) * BigInt(line.quantity);
  return assertDiscountBaseAmount(baseAmount);
}

export class DiscountCalculationInvalidBaseAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscountCalculationInvalidBaseAmountError';
  }
}

export class DiscountCalculationInvalidContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscountCalculationInvalidContextError';
  }
}

export class DiscountCalculationInvalidDiscountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscountCalculationInvalidDiscountError';
  }
}

export class DiscountCalculationOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscountCalculationOverflowError';
  }
}
