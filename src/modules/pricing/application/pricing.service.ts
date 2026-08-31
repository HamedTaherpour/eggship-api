import { Injectable, Optional } from '@nestjs/common';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { TransactionContext } from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-event';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { ProductRecord } from '../../products/domain/product';
import { ProductNotFoundError } from '../../products/domain/product-errors';
import { normalizeProductPrice } from '../../products/domain/product-price';
import { ProductRepository } from '../../products/infrastructure/product.repository';
import {
  assertPriceHistoryActor,
  PriceHistoryActorType,
  type PriceHistoryActor,
} from '../domain/price-history-actor';
import { PricingAdminRequiredError } from '../domain/pricing-errors';
import { PriceHistoryRepository } from '../infrastructure/price-history.repository';

export interface ChangeProductPriceInput {
  productId: string;
  newPrice: number;
  actor: PriceHistoryActor;
}

export interface ChangeProductPriceResult {
  product: ProductRecord;
  historyWritten: boolean;
}

/**
 * Pricing application boundary (PRC-01). Owns atomic Product price changes and
 * append-only PriceHistory rows. Product creation sets the initial price without
 * history; only subsequent changes write history.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly products: ProductRepository,
    private readonly priceHistory: PriceHistoryRepository,
    private readonly transactions: TransactionRunner,
    private readonly logger: ApplicationLogger,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  requireAdminActor(principal: AuthenticatedPrincipal): PriceHistoryActor {
    if (principal.subjectType !== AuthSubjectType.ADMIN) {
      throw new PricingAdminRequiredError();
    }
    return assertPriceHistoryActor({
      type: PriceHistoryActorType.ADMIN,
      id: principal.subjectId,
    });
  }

  async changeProductPrice(
    input: ChangeProductPriceInput,
    existingTx?: TransactionContext,
  ): Promise<ChangeProductPriceResult> {
    const newPrice = normalizeProductPrice(input.newPrice);
    const actor = assertPriceHistoryActor(input.actor);

    const run = async (
      tx: TransactionContext,
    ): Promise<ChangeProductPriceResult> =>
      this.changeProductPriceInTransaction(
        input.productId,
        newPrice,
        actor,
        tx,
      );

    if (existingTx !== undefined) {
      return run(existingTx);
    }
    return this.transactions.run(run);
  }

  private async changeProductPriceInTransaction(
    productId: string,
    newPrice: number,
    actor: PriceHistoryActor,
    tx: TransactionContext,
  ): Promise<ChangeProductPriceResult> {
    const locked = await this.products.findByIdForUpdate(productId, tx);
    if (locked === null) {
      throw new ProductNotFoundError();
    }

    if (locked.price === newPrice) {
      return { product: locked, historyWritten: false };
    }

    const updated = await this.products.updatePrice(productId, newPrice, tx);
    if (updated === null) {
      throw new ProductNotFoundError();
    }

    await this.priceHistory.append(
      {
        productId,
        oldPrice: locked.price,
        newPrice,
        actorType: actor.type,
        actorId: actor.id,
      },
      tx,
    );
    if (this.audit !== undefined)
      await this.audit.append(
        {
          action: AuditAction.PRICE_CHANGED,
          actorType: actor.type,
          actorId: actor.id,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          metadata: { previousPrice: locked.price, newPrice },
        },
        tx,
      );

    this.logger.info(
      {
        module: 'pricing',
        operation: 'pricing.product.price_changed',
        productId,
        oldPrice: locked.price,
        newPrice,
        actorType: actor.type,
        actorId: actor.id,
      },
      'Product price changed',
    );

    return { product: updated, historyWritten: true };
  }
}
