import { OrderInvalidInputError } from './order-errors';
import { OrderMessage } from './order-messages';
import { parseOptionalDeliveryAt } from './order-delivery-at';

describe('deliveryAt parsing', () => {
  it('returns undefined when omitted', () => {
    expect(parseOptionalDeliveryAt(undefined)).toBeUndefined();
  });

  it('accepts a valid Date', () => {
    const value = new Date('2026-08-22T12:00:00.000Z');
    expect(parseOptionalDeliveryAt(value)).toBe(value);
  });

  it('accepts a deterministic ISO-8601 instant', () => {
    expect(
      parseOptionalDeliveryAt('2026-08-22T12:00:00.000Z')?.toISOString(),
    ).toBe('2026-08-22T12:00:00.000Z');
  });

  it('does not require the timestamp to be in the future', () => {
    const past = parseOptionalDeliveryAt('2020-01-01T00:00:00.000Z');
    expect(past?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('rejects invalid Date instances', () => {
    expect(() => parseOptionalDeliveryAt(new Date('not-a-date'))).toThrow(
      OrderInvalidInputError,
    );
    expect(() => parseOptionalDeliveryAt(new Date('not-a-date'))).toThrow(
      OrderMessage.INVALID_DELIVERY_AT,
    );
  });

  it('rejects non-instant strings', () => {
    expect(() => parseOptionalDeliveryAt('tomorrow')).toThrow(
      OrderInvalidInputError,
    );
    expect(() => parseOptionalDeliveryAt('2026-08-22')).toThrow(
      OrderInvalidInputError,
    );
  });
});
