import { OrderCancellationReasonRequiredError } from './order-errors';
import { OrderMessage } from './order-messages';

export const ORDER_CANCEL_REASON_MAX_LENGTH = 500;

/**
 * Admin cancellation reason: trimmed, 1–500 characters. No enum in V1.
 */
export function normalizeAdminCancelReason(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OrderCancellationReasonRequiredError(
      OrderMessage.CANCELLATION_REASON_REQUIRED,
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > ORDER_CANCEL_REASON_MAX_LENGTH) {
    throw new OrderCancellationReasonRequiredError(
      OrderMessage.CANCELLATION_REASON_REQUIRED,
    );
  }
  return trimmed;
}
