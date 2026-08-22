import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { InventoryErrorCode } from '../domain/inventory-errors';
import { InventoryHttpMessage } from '../domain/inventory-http-messages';
import { isInventoryUuid } from '../domain/inventory-quantity';

const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Reads the caller-provided idempotency key from the `Idempotency-Key` header.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.header(IDEMPOTENCY_HEADER);
    if (raw === undefined || raw.trim() === '') {
      throw new BadRequestException({
        code: InventoryErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        message: InventoryHttpMessage.IDEMPOTENCY_KEY_REQUIRED,
      });
    }
    const trimmed = raw.trim();
    if (!isInventoryUuid(trimmed)) {
      throw new BadRequestException({
        code: InventoryErrorCode.IDEMPOTENCY_KEY_INVALID,
        message: InventoryHttpMessage.IDEMPOTENCY_KEY_INVALID,
      });
    }
    return trimmed.toLowerCase();
  },
);

export { IDEMPOTENCY_HEADER };
