import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrderHttpMessage } from '../domain/order-http-messages';
import { isOrderUuid } from '../domain/order-snapshot';

const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Reads the caller-provided UUID from the `Idempotency-Key` header (ORD-03A).
 * Uses the shared stable codes `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.header(IDEMPOTENCY_HEADER);
    if (raw === undefined || raw.trim() === '') {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: OrderHttpMessage.IDEMPOTENCY_KEY_REQUIRED,
      });
    }
    const trimmed = raw.trim();
    if (!isOrderUuid(trimmed)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: OrderHttpMessage.IDEMPOTENCY_KEY_INVALID,
      });
    }
    return trimmed.toLowerCase();
  },
);

export { IDEMPOTENCY_HEADER };
