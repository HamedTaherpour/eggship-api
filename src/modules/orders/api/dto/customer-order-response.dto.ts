import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AppliedDiscountSnapshot } from '../../../pricing/domain/discount-calculation';
import type { OrderLineRecord, OrderRecord } from '../../domain/order';
import { orderMoneyToJson } from '../../domain/order-money';

/**
 * Applied discount evidence safe for the customer create response.
 * Does not expose Admin lifecycle or mutable Discount state.
 */
export class CustomerAppliedDiscountDto {
  @ApiProperty({ format: 'uuid' })
  discountId!: string;

  @ApiProperty({ example: 'Weekend eggs' })
  name!: string;

  @ApiProperty({ enum: ['PERCENT', 'FIXED'] })
  type!: string;

  @ApiProperty({ enum: ['ORDER', 'PRODUCT', 'CATEGORY'] })
  target!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Percent 1–100 when type is PERCENT; otherwise null.',
  })
  percentValue!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Fixed Toman amount when type is FIXED; otherwise null.',
  })
  fixedAmount!: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  productId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  categoryId!: string | null;
}

export class CustomerOrderLineDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Cage-free eggs 6-pack' })
  productName!: string;

  @ApiProperty({
    type: Number,
    description: 'Snapshotted unit price in integer Toman.',
  })
  unitPrice!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({
    type: Number,
    description: 'Units that received the LINE discount (0…quantity).',
  })
  discountedQuantity!: number;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
    description:
      'Gross line total (unitPrice × quantity). Number when JSON-safe; otherwise decimal string.',
  })
  grossLineTotal!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  lineDiscountAmount!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  finalLineTotal!: number | string;

  @ApiPropertyOptional({
    type: CustomerAppliedDiscountDto,
    nullable: true,
  })
  appliedLineDiscount!: CustomerAppliedDiscountDto | null;
}

/**
 * Minimal customer-facing Order after create or idempotent replay (ORD-03A).
 * Omits Admin/internal fields (idempotency hash, commercePolicyRevision,
 * cancel metadata, lifecycle timestamps reserved for detail/list).
 */
export class CustomerOrderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: [
      'PENDING_REVIEW',
      'CONFIRMED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'RETURNED',
    ],
    example: 'PENDING_REVIEW',
  })
  status!: string;

  @ApiProperty({
    example: '+989121234567',
    description: 'Immutable customer phone snapshot at create time.',
  })
  customerPhone!: string;

  @ApiProperty({ format: 'uuid' })
  regionId!: string;

  @ApiProperty({ example: 'Tehran' })
  regionName!: string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  grossSubtotal!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  lineDiscountTotal!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  subtotalAfterLineDiscounts!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  orderDiscountAmount!: number | string;

  @ApiProperty({
    oneOf: [{ type: 'number' }, { type: 'string' }],
  })
  total!: number | string;

  @ApiProperty({
    format: 'date-time',
    description: 'Shared pricing/commerce evaluation instant (UTC ISO-8601).',
  })
  pricingEvaluatedAt!: string;

  @ApiPropertyOptional({
    type: CustomerAppliedDiscountDto,
    nullable: true,
  })
  appliedOrderDiscount!: CustomerAppliedDiscountDto | null;

  @ApiProperty({ type: CustomerOrderLineDto, isArray: true })
  lines!: CustomerOrderLineDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreateOrderResponseDto {
  @ApiProperty({ type: CustomerOrderDto })
  data!: CustomerOrderDto;
}

function toAppliedDiscountDto(
  snapshot: AppliedDiscountSnapshot | null,
): CustomerAppliedDiscountDto | null {
  if (snapshot === null) {
    return null;
  }
  return {
    discountId: snapshot.discountId,
    name: snapshot.name,
    type: snapshot.type,
    target: snapshot.target,
    percentValue: snapshot.percentValue,
    fixedAmount: snapshot.fixedAmount,
    productId: snapshot.productId,
    categoryId: snapshot.categoryId,
  };
}

function toCustomerOrderLineDto(line: OrderLineRecord): CustomerOrderLineDto {
  return {
    id: line.id,
    productId: line.productId,
    productName: line.productName,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    discountedQuantity: line.discountedQuantity,
    grossLineTotal: orderMoneyToJson(line.grossLineTotal),
    lineDiscountAmount: orderMoneyToJson(line.lineDiscountAmount),
    finalLineTotal: orderMoneyToJson(line.finalLineTotal),
    appliedLineDiscount: toAppliedDiscountDto(line.appliedLineDiscount),
  };
}

export function toCustomerOrderDto(order: OrderRecord): CustomerOrderDto {
  return {
    id: order.id,
    status: order.status,
    customerPhone: order.customerPhone,
    regionId: order.regionId,
    regionName: order.regionName,
    grossSubtotal: orderMoneyToJson(order.grossSubtotal),
    lineDiscountTotal: orderMoneyToJson(order.lineDiscountTotal),
    subtotalAfterLineDiscounts: orderMoneyToJson(
      order.subtotalAfterLineDiscounts,
    ),
    orderDiscountAmount: orderMoneyToJson(order.orderDiscountAmount),
    total: orderMoneyToJson(order.total),
    pricingEvaluatedAt: order.pricingEvaluatedAt.toISOString(),
    appliedOrderDiscount: toAppliedDiscountDto(order.appliedOrderDiscount),
    lines: order.lines.map(toCustomerOrderLineDto),
    createdAt: order.createdAt.toISOString(),
  };
}
