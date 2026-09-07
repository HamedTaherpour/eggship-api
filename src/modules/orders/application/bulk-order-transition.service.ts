import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { OrderAdminActor } from '../domain/order-actor';
import type { OrderRecord } from '../domain/order';
import { OrderTransitionService } from './order-transition.service';
import { normalizeException } from '../../../common/http/error-contract';

export const ADMIN_BULK_ORDER_TRANSITION_MAXIMUM = 50;

export const BulkOrderTransitionAction = {
  SHIP: 'SHIP',
  DELIVER: 'DELIVER',
} as const;

export type BulkOrderTransitionAction =
  (typeof BulkOrderTransitionAction)[keyof typeof BulkOrderTransitionAction];

export interface BulkOrderTransitionCommand {
  action: BulkOrderTransitionAction;
  orderIds: readonly string[];
  actor: OrderAdminActor;
}

export interface BulkOrderTransitionSuccess {
  orderId: string;
  success: true;
  replay: boolean;
  order: OrderRecord;
}

export interface BulkOrderTransitionFailure {
  orderId: string;
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> };
}

export type BulkOrderTransitionItemResult =
  BulkOrderTransitionSuccess | BulkOrderTransitionFailure;

export interface BulkOrderTransitionResult {
  action: BulkOrderTransitionAction;
  summary: { requested: number; succeeded: number; failed: number };
  results: BulkOrderTransitionItemResult[];
}

/**
 * Synchronous Admin bulk command. Items are deliberately processed in request
 * order: each delegated single-order command opens its own transaction, while
 * a conservative batch cap avoids holding excessive database connections.
 */
@Injectable()
export class BulkOrderTransitionService {
  constructor(
    private readonly transitions: OrderTransitionService,
    private readonly logger: ApplicationLogger,
  ) {}

  async execute(
    command: BulkOrderTransitionCommand,
  ): Promise<BulkOrderTransitionResult> {
    const results: BulkOrderTransitionItemResult[] = [];

    for (const orderId of command.orderIds) {
      try {
        const result =
          command.action === BulkOrderTransitionAction.SHIP
            ? await this.transitions.shipOrder({
                orderId,
                actor: command.actor,
              })
            : await this.transitions.deliverOrder({
                orderId,
                actor: command.actor,
              });
        results.push({
          orderId,
          success: true,
          replay: result.replay,
          order: result.order,
        });
      } catch (error: unknown) {
        results.push(this.toFailure(orderId, command.action, error));
      }
    }

    const succeeded = results.filter((result) => result.success).length;
    return {
      action: command.action,
      summary: {
        requested: results.length,
        succeeded,
        failed: results.length - succeeded,
      },
      results,
    };
  }

  private toFailure(
    orderId: string,
    action: BulkOrderTransitionAction,
    error: unknown,
  ): BulkOrderTransitionFailure {
    if (error instanceof ApplicationError) {
      const normalized = normalizeException(error);
      return {
        orderId,
        success: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        },
      };
    }

    this.logger.error(
      {
        module: 'orders',
        operation: 'order.bulk-transition.item-failed',
        orderId,
        action,
      },
      'Bulk order transition item failed unexpectedly',
      error instanceof Error ? error : undefined,
    );
    return {
      orderId,
      success: false,
      error: {
        code: 'ORDER_BULK_ITEM_FAILED',
        message: 'تغییر وضعیت این سفارش انجام نشد.',
        details: {},
      },
    };
  }
}
