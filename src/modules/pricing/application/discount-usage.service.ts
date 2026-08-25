import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type { DiscountRecord } from '../domain/discount';
import {
  collectCappedProductDiscountIds,
  remainingEligibleQuantity,
} from '../domain/discount-lifetime-quantity';
import type { DiscountUsageConsumeIntent } from '../domain/discount-usage';
import { DiscountUsageRepository } from '../infrastructure/discount-usage.repository';

/**
 * Application boundary for lifetime discounted-quantity usage (DLU-02).
 * Orders orchestrates create/cancel; this service owns lock + consume/release.
 */
@Injectable()
export class DiscountUsageService {
  constructor(private readonly usage: DiscountUsageRepository) {}

  /**
   * Lock capped PRODUCT usage aggregates (sorted discountId) and return
   * remainingEligibleQuantity by discountId for PRC-05 partial pricing.
   */
  async lockRemainingForPricing(
    input: {
      userId: string;
      discounts: readonly DiscountRecord[];
    },
    tx: TransactionContext,
  ): Promise<Map<string, number>> {
    const cappedIds = collectCappedProductDiscountIds(input.discounts);
    const consumedByDiscountId = await this.usage.lockUsageAggregates(
      input.userId,
      cappedIds,
      tx,
    );

    const remainingByDiscountId = new Map<string, number>();
    for (const discount of input.discounts) {
      if (
        discount.maxQuantityPerCustomer === null ||
        !cappedIds.includes(discount.id)
      ) {
        continue;
      }
      const consumed = consumedByDiscountId.get(discount.id) ?? 0;
      const remaining = remainingEligibleQuantity({
        maxQuantityPerCustomer: discount.maxQuantityPerCustomer,
        consumedQuantity: consumed,
      });
      remainingByDiscountId.set(discount.id, remaining ?? 0);
    }
    return remainingByDiscountId;
  }

  async consumeForOrder(
    input: {
      orderId: string;
      userId: string;
      consumptions: readonly DiscountUsageConsumeIntent[];
    },
    tx: TransactionContext,
  ): Promise<void> {
    await this.usage.consumeForOrder(input, tx);
  }

  async releaseForOrder(
    input: { orderId: string; userId: string },
    tx: TransactionContext,
  ): Promise<void> {
    await this.usage.releaseForOrder(input, tx);
  }
}
