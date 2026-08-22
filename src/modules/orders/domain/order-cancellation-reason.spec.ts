import { OrderCancellationReasonRequiredError } from './order-errors';
import { OrderMessage } from './order-messages';
import {
  normalizeAdminCancelReason,
  ORDER_CANCEL_REASON_MAX_LENGTH,
} from './order-cancellation-reason';

describe('admin cancellation reason', () => {
  it('trims a valid reason', () => {
    expect(normalizeAdminCancelReason('  out of stock  ')).toBe('out of stock');
  });

  it('rejects missing, empty, and whitespace-only values', () => {
    expect(() => normalizeAdminCancelReason(undefined)).toThrow(
      OrderCancellationReasonRequiredError,
    );
    expect(() => normalizeAdminCancelReason('')).toThrow(
      OrderMessage.CANCELLATION_REASON_REQUIRED,
    );
    expect(() => normalizeAdminCancelReason('   ')).toThrow(
      OrderCancellationReasonRequiredError,
    );
  });

  it('rejects reasons longer than 500 characters', () => {
    expect(() =>
      normalizeAdminCancelReason(
        'x'.repeat(ORDER_CANCEL_REASON_MAX_LENGTH + 1),
      ),
    ).toThrow(OrderCancellationReasonRequiredError);
  });

  it('accepts a 500-character reason', () => {
    const reason = 'y'.repeat(ORDER_CANCEL_REASON_MAX_LENGTH);
    expect(normalizeAdminCancelReason(reason)).toBe(reason);
  });
});
