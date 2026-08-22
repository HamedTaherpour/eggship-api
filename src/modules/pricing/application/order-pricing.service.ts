import { Injectable } from '@nestjs/common';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { ProductRepository } from '../../products/infrastructure/product.repository';
import {
  composeOrderPricing,
  normalizeOrderPricingLineInputs,
  type OrderPricingLineInput,
  type OrderPricingProductContext,
  type OrderPricingSnapshot,
} from '../domain/order-pricing';
import { OrderPricingProductUnavailableError } from '../domain/order-pricing-errors';
import { DiscountRepository } from '../infrastructure/discount.repository';

export interface PriceOrderLinesOptions {
  /**
   * Shared eligibility/pricing instant for the whole operation.
   * Defaults to one `new Date()` at entry — never per-line clocks.
   */
  evaluatedAt?: Date;
  /**
   * Join an ORD-03 (or other) outer PostgreSQL transaction when provided.
   * Without `tx`, uses REPEATABLE READ snapshot reads for coherent Product +
   * Discount loads.
   */
  tx?: TransactionContext;
}

/**
 * Server-authoritative order pricing composition (PRC-05).
 * Persistence-neutral: returns a snapshot ORD-03 can write later.
 * No HTTP, no Order mutation, no promo codes.
 */
@Injectable()
export class OrderPricingService {
  constructor(
    private readonly products: ProductRepository,
    private readonly discounts: DiscountRepository,
    private readonly transactions: TransactionRunner,
  ) {}

  async priceOrderLines(
    lines: readonly OrderPricingLineInput[],
    options: PriceOrderLinesOptions = {},
  ): Promise<OrderPricingSnapshot> {
    const evaluatedAt = options.evaluatedAt ?? new Date();
    const normalizedLines = normalizeOrderPricingLineInputs(lines);

    const run = async (tx: TransactionContext): Promise<OrderPricingSnapshot> =>
      this.priceWithinTransaction(normalizedLines, evaluatedAt, tx);

    if (options.tx !== undefined) {
      return this.transactions.runIn(options.tx, run);
    }
    return this.transactions.runSnapshotRead(run);
  }

  private async priceWithinTransaction(
    normalizedLines: OrderPricingLineInput[],
    evaluatedAt: Date,
    tx: TransactionContext,
  ): Promise<OrderPricingSnapshot> {
    const productIds = normalizedLines.map((line) => line.productId);
    const products = await this.products.findPublicByIds(productIds, tx);
    const productsById = new Map(
      products.map((product) => [product.id, product] as const),
    );

    const pricedContexts: OrderPricingProductContext[] = [];
    for (const line of normalizedLines) {
      const product = productsById.get(line.productId);
      if (product === undefined) {
        throw new OrderPricingProductUnavailableError();
      }
      pricedContexts.push({
        productId: product.id,
        productName: product.name,
        categoryId: product.categoryId,
        unitPrice: product.price,
        quantity: line.quantity,
      });
    }

    const categoryIds = [
      ...new Set(pricedContexts.map((line) => line.categoryId)),
    ];
    const candidates = await this.discounts.findCandidatesForOrderPricing(
      { productIds, categoryIds },
      tx,
    );

    return composeOrderPricing({
      evaluatedAt,
      lines: pricedContexts,
      discounts: candidates,
    });
  }
}
