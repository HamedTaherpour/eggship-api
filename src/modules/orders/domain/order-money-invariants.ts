import type { AppliedDiscountSnapshot } from '../../pricing/domain/discount-calculation';
import { DiscountTarget, DiscountType } from '../../pricing/domain/discount';
import { OrderInvalidInputError, OrderInvalidMoneyError } from './order-errors';
import {
  assertOrderMoneyAmount,
  assertOrderUnitPrice,
  computeLineTotal,
} from './order-money';
import type {
  TrustedCreateOrderInput,
  TrustedOrderLineSnapshot,
} from './order';

/**
 * Re-validate PRC-05 → persistence money invariants before write.
 * Application owns cross-line aggregates; DB CHECKs cover per-row facts.
 */
export function assertTrustedCreateOrderMoney(
  input: TrustedCreateOrderInput,
): void {
  if (!(input.pricingEvaluatedAt instanceof Date)) {
    throw new OrderInvalidInputError(
      'Order pricingEvaluatedAt must be a valid Date.',
    );
  }
  if (Number.isNaN(input.pricingEvaluatedAt.getTime())) {
    throw new OrderInvalidInputError(
      'Order pricingEvaluatedAt must be a valid Date.',
    );
  }
  if (input.lines.length === 0) {
    throw new OrderInvalidInputError('Order must have at least one line.');
  }

  let grossSubtotal = 0n;
  let lineDiscountTotal = 0n;
  let subtotalAfterLineDiscounts = 0n;

  for (const line of input.lines) {
    assertTrustedLineMoney(line);
    grossSubtotal += line.grossLineTotal;
    lineDiscountTotal += line.lineDiscountAmount;
    subtotalAfterLineDiscounts += line.finalLineTotal;
    assertOrderMoneyAmount(grossSubtotal, 'grossSubtotal');
    assertOrderMoneyAmount(lineDiscountTotal, 'lineDiscountTotal');
    assertOrderMoneyAmount(
      subtotalAfterLineDiscounts,
      'subtotalAfterLineDiscounts',
    );
  }

  if (input.grossSubtotal !== grossSubtotal) {
    throw new OrderInvalidMoneyError(
      'Order grossSubtotal must equal the sum of grossLineTotal.',
    );
  }
  if (input.lineDiscountTotal !== lineDiscountTotal) {
    throw new OrderInvalidMoneyError(
      'Order lineDiscountTotal must equal the sum of lineDiscountAmount.',
    );
  }
  if (input.subtotalAfterLineDiscounts !== subtotalAfterLineDiscounts) {
    throw new OrderInvalidMoneyError(
      'Order subtotalAfterLineDiscounts must equal the sum of finalLineTotal.',
    );
  }

  assertOrderMoneyAmount(input.orderDiscountAmount, 'orderDiscountAmount');
  assertOrderMoneyAmount(input.total, 'total');

  if (
    input.total !==
    input.subtotalAfterLineDiscounts - input.orderDiscountAmount
  ) {
    throw new OrderInvalidMoneyError(
      'Order total must equal subtotalAfterLineDiscounts − orderDiscountAmount.',
    );
  }

  assertAppliedOrderDiscountConsistency(
    input.appliedOrderDiscount,
    input.orderDiscountAmount,
  );
}

function assertTrustedLineMoney(line: TrustedOrderLineSnapshot): void {
  assertOrderUnitPrice(line.unitPrice);
  const expectedGross = computeLineTotal(line.unitPrice, line.quantity);
  if (line.grossLineTotal !== expectedGross) {
    throw new OrderInvalidMoneyError(
      'Order line grossLineTotal must equal unitPrice × quantity.',
    );
  }
  assertOrderMoneyAmount(line.lineDiscountAmount, 'lineDiscountAmount');
  assertOrderMoneyAmount(line.finalLineTotal, 'finalLineTotal');
  if (line.finalLineTotal !== line.grossLineTotal - line.lineDiscountAmount) {
    throw new OrderInvalidMoneyError(
      'Order line finalLineTotal must equal grossLineTotal − lineDiscountAmount.',
    );
  }
  assertAppliedLineDiscountConsistency(
    line.appliedLineDiscount,
    line.lineDiscountAmount,
  );
}

function assertAppliedLineDiscountConsistency(
  applied: AppliedDiscountSnapshot | null,
  lineDiscountAmount: bigint,
): void {
  if (applied === null) {
    if (lineDiscountAmount !== 0n) {
      throw new OrderInvalidMoneyError(
        'Line discount amount requires applied LINE discount evidence.',
      );
    }
    return;
  }
  assertAppliedDiscountShape(applied, 'LINE');
  if (
    applied.target !== DiscountTarget.PRODUCT &&
    applied.target !== DiscountTarget.CATEGORY
  ) {
    throw new OrderInvalidInputError(
      'Applied LINE discount target must be PRODUCT or CATEGORY.',
    );
  }
}

function assertAppliedOrderDiscountConsistency(
  applied: AppliedDiscountSnapshot | null,
  orderDiscountAmount: bigint,
): void {
  if (applied === null) {
    if (orderDiscountAmount !== 0n) {
      throw new OrderInvalidMoneyError(
        'Order discount amount requires applied ORDER discount evidence.',
      );
    }
    return;
  }
  assertAppliedDiscountShape(applied, 'ORDER');
  if (applied.target !== DiscountTarget.ORDER) {
    throw new OrderInvalidInputError(
      'Applied ORDER discount target must be ORDER.',
    );
  }
}

function assertAppliedDiscountShape(
  applied: AppliedDiscountSnapshot,
  scope: 'LINE' | 'ORDER',
): void {
  if (
    typeof applied.discountId !== 'string' ||
    applied.discountId.length === 0
  ) {
    throw new OrderInvalidInputError(
      `Applied ${scope} discountId is required.`,
    );
  }
  if (typeof applied.name !== 'string' || applied.name.trim().length === 0) {
    throw new OrderInvalidInputError(
      `Applied ${scope} discount name is required.`,
    );
  }
  if (
    applied.type !== DiscountType.PERCENT &&
    applied.type !== DiscountType.FIXED
  ) {
    throw new OrderInvalidInputError(
      `Applied ${scope} discount type is invalid.`,
    );
  }
  if (
    typeof applied.precedence !== 'number' ||
    !Number.isInteger(applied.precedence)
  ) {
    throw new OrderInvalidInputError(
      `Applied ${scope} discount precedence must be an integer.`,
    );
  }
  if (applied.type === DiscountType.PERCENT) {
    if (
      applied.percentValue === null ||
      applied.fixedAmount !== null ||
      applied.percentValue < 1 ||
      applied.percentValue > 100
    ) {
      throw new OrderInvalidInputError(
        `Applied ${scope} PERCENT discount requires percentValue 1–100.`,
      );
    }
  } else if (
    applied.fixedAmount === null ||
    applied.percentValue !== null ||
    applied.fixedAmount < 1
  ) {
    throw new OrderInvalidInputError(
      `Applied ${scope} FIXED discount requires positive fixedAmount.`,
    );
  }
}
