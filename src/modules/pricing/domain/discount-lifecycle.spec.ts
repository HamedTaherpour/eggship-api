import { DiscountTarget, DiscountType } from './discount';
import {
  buildDiscountPayload,
  isPotentiallyApplicable,
  isWithinActivationWindow,
} from './discount-lifecycle';
import { DiscountInvalidWindowError } from './discount-errors';

describe('discount activation window', () => {
  const startsAt = new Date('2026-08-01T00:00:00.000Z');
  const endsAt = new Date('2026-08-31T23:59:59.999Z');

  it('treats null bounds as unbounded', () => {
    expect(
      isWithinActivationWindow({ startsAt: null, endsAt: null }, startsAt),
    ).toBe(true);
  });

  it('rejects now before startsAt or at/after endsAt', () => {
    expect(isWithinActivationWindow({ startsAt, endsAt: null }, startsAt)).toBe(
      true,
    );
    expect(
      isWithinActivationWindow(
        { startsAt, endsAt: null },
        new Date('2026-07-31T23:59:59.999Z'),
      ),
    ).toBe(false);
    expect(isWithinActivationWindow({ startsAt: null, endsAt }, endsAt)).toBe(
      false,
    );
  });

  it('combines isActive with the window for potential applicability', () => {
    const record = {
      isActive: true,
      startsAt,
      endsAt,
    };
    expect(
      isPotentiallyApplicable(record, new Date('2026-08-15T12:00:00.000Z')),
    ).toBe(true);
    expect(
      isPotentiallyApplicable(
        { ...record, isActive: false },
        new Date('2026-08-15T12:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      isPotentiallyApplicable(record, new Date('2026-09-01T00:00:00.000Z')),
    ).toBe(false);
  });
});

describe('buildDiscountPayload', () => {
  it('rejects invalid windows at the application layer', () => {
    expect(() =>
      buildDiscountPayload({
        name: 'Summer sale',
        type: DiscountType.PERCENT,
        target: DiscountTarget.ORDER,
        percentValue: 10,
        isActive: true,
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-01T00:00:00.000Z'),
        precedence: 0,
      }),
    ).toThrow(DiscountInvalidWindowError);
  });
});
