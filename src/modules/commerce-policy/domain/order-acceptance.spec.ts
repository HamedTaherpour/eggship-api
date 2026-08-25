import {
  CommerceOverrideMode,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsRecord,
} from './commerce-policy';
import {
  OrderingClosedError,
  OrderingPolicyUnavailableError,
  OrderMinimumQuantityNotMetError,
} from './commerce-policy-errors';
import {
  evaluateOrderAcceptance,
  isWithinPreviousSpecialHoursTail,
  isWithinRegularWindow,
  isWithinSpecialHoursOnAnchorDate,
  previousLocalDate,
  sumNormalizedOrderQuantities,
  toTehranLocalWallClock,
} from './order-acceptance';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-01-01T00:00:00.000Z');

/** Asia/Tehran is UTC+03:30 year-round (no DST). */
function tehranInstant(localDate: string, hour: number, minute: number): Date {
  const parts = localDate.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('invalid localDate');
  }
  // Construct as UTC then subtract the +03:30 offset.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - 3.5 * 3_600_000;
  return new Date(utcMs);
}

function settings(
  overrides: Partial<CommerceSettingsRecord> = {},
): CommerceSettingsRecord {
  return {
    orderingScheduleEnabled: true,
    orderingOpensAtLocalMinute: 7 * 60,
    orderingClosesAtLocalMinute: 16 * 60,
    minimumOrderQuantity: 1,
    revision: 1,
    createdByAdminId: ADMIN,
    updatedByAdminId: ADMIN,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function override(
  localDate: string,
  partial: Partial<CommerceScheduleOverrideRecord> &
    Pick<CommerceScheduleOverrideRecord, 'mode'>,
): CommerceScheduleOverrideRecord {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    localDate,
    opensAtLocalMinute: null,
    closesAtLocalMinute: null,
    createdByAdminId: ADMIN,
    updatedByAdminId: ADMIN,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe('order-acceptance domain', () => {
  describe('toTehranLocalWallClock', () => {
    it('converts a UTC instant to Asia/Tehran date and minute', () => {
      expect(
        toTehranLocalWallClock(tehranInstant('2026-08-25', 15, 30)),
      ).toEqual({
        localDate: '2026-08-25',
        localMinute: 15 * 60 + 30,
      });
    });
  });

  describe('window helpers', () => {
    it('treats regular windows as half-open with cross-midnight support', () => {
      expect(isWithinRegularWindow(7 * 60, 7 * 60, 16 * 60)).toBe(true);
      expect(isWithinRegularWindow(16 * 60 - 1, 7 * 60, 16 * 60)).toBe(true);
      expect(isWithinRegularWindow(16 * 60, 7 * 60, 16 * 60)).toBe(false);
      expect(isWithinRegularWindow(7 * 60 - 1, 7 * 60, 16 * 60)).toBe(false);

      expect(isWithinRegularWindow(18 * 60, 18 * 60, 2 * 60)).toBe(true);
      expect(isWithinRegularWindow(2 * 60 - 1, 18 * 60, 2 * 60)).toBe(true);
      expect(isWithinRegularWindow(2 * 60, 18 * 60, 2 * 60)).toBe(false);
      expect(isWithinRegularWindow(18 * 60 - 1, 18 * 60, 2 * 60)).toBe(false);
    });

    it('limits SPECIAL_HOURS on the anchor date to the evening portion when crossing midnight', () => {
      expect(isWithinSpecialHoursOnAnchorDate(18 * 60, 18 * 60, 2 * 60)).toBe(
        true,
      );
      expect(
        isWithinSpecialHoursOnAnchorDate(2 * 60 - 1, 18 * 60, 2 * 60),
      ).toBe(false);
      expect(
        isWithinPreviousSpecialHoursTail(2 * 60 - 1, 18 * 60, 2 * 60),
      ).toBe(true);
      expect(isWithinPreviousSpecialHoursTail(2 * 60, 18 * 60, 2 * 60)).toBe(
        false,
      );
      expect(isWithinPreviousSpecialHoursTail(12 * 60, 10 * 60, 14 * 60)).toBe(
        false,
      );
    });
  });

  describe('evaluateOrderAcceptance', () => {
    it('accepts an open regular window including opensAt and rejects closesAt', () => {
      expect(
        evaluateOrderAcceptance({
          settings: settings(),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 7, 0),
          normalizedLines: [{ quantity: 1 }],
        }).localMinute,
      ).toBe(7 * 60);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings(),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 6, 59),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings(),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 16, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);

      expect(
        evaluateOrderAcceptance({
          settings: settings(),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 15, 59),
          normalizedLines: [{ quantity: 1 }],
        }).revision,
      ).toBe(1);
    });

    it('treats a disabled regular schedule as always-open fallback', () => {
      expect(
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 3, 0),
          normalizedLines: [{ quantity: 1 }],
        }).revision,
      ).toBe(1);
    });

    it('fails closed when settings are missing or invalid', () => {
      expect(() =>
        evaluateOrderAcceptance({
          settings: null,
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 12, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingPolicyUnavailableError);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({ orderingOpensAtLocalMinute: 16 * 60 }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 12, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingPolicyUnavailableError);
    });

    it('honors CLOSED overrides over an otherwise open regular schedule', () => {
      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: override('2026-08-25', {
            mode: CommerceOverrideMode.CLOSED,
          }),
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 12, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);
    });

    it('applies SPECIAL_HOURS on the current date and suppresses prior-date carry-in', () => {
      const special = override('2026-08-25', {
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAtLocalMinute: 10 * 60,
        closesAtLocalMinute: 12 * 60,
      });
      const priorCross = override('2026-08-24', {
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAtLocalMinute: 18 * 60,
        closesAtLocalMinute: 11 * 60,
      });

      expect(
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: special,
          previousDateOverride: priorCross,
          evaluatedAt: tehranInstant('2026-08-25', 10, 0),
          normalizedLines: [{ quantity: 1 }],
        }).localMinute,
      ).toBe(10 * 60);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: special,
          previousDateOverride: priorCross,
          evaluatedAt: tehranInstant('2026-08-25', 9, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);
    });

    it('supports regular and SPECIAL_HOURS cross-midnight windows', () => {
      expect(
        evaluateOrderAcceptance({
          settings: settings({
            orderingOpensAtLocalMinute: 18 * 60,
            orderingClosesAtLocalMinute: 2 * 60,
          }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 18, 0),
          normalizedLines: [{ quantity: 1 }],
        }).localMinute,
      ).toBe(18 * 60);

      expect(
        evaluateOrderAcceptance({
          settings: settings({
            orderingOpensAtLocalMinute: 18 * 60,
            orderingClosesAtLocalMinute: 2 * 60,
          }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-26', 1, 59),
          normalizedLines: [{ quantity: 1 }],
        }).localMinute,
      ).toBe(1 * 60 + 59);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({
            orderingOpensAtLocalMinute: 18 * 60,
            orderingClosesAtLocalMinute: 2 * 60,
          }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-26', 2, 0),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);

      expect(
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: null,
          previousDateOverride: override('2026-08-25', {
            mode: CommerceOverrideMode.SPECIAL_HOURS,
            opensAtLocalMinute: 18 * 60,
            closesAtLocalMinute: 2 * 60,
          }),
          evaluatedAt: tehranInstant('2026-08-26', 1, 30),
          normalizedLines: [{ quantity: 1 }],
        }).localDate,
      ).toBe('2026-08-26');

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({ orderingScheduleEnabled: false }),
          currentDateOverride: override('2026-08-26', {
            mode: CommerceOverrideMode.CLOSED,
          }),
          previousDateOverride: override('2026-08-25', {
            mode: CommerceOverrideMode.SPECIAL_HOURS,
            opensAtLocalMinute: 18 * 60,
            closesAtLocalMinute: 2 * 60,
          }),
          evaluatedAt: tehranInstant('2026-08-26', 1, 30),
          normalizedLines: [{ quantity: 1 }],
        }),
      ).toThrow(OrderingClosedError);
    });

    it('enforces minimum quantity on the exact boundary and below', () => {
      expect(
        evaluateOrderAcceptance({
          settings: settings({ minimumOrderQuantity: 5 }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 12, 0),
          normalizedLines: [{ quantity: 2 }, { quantity: 3 }],
        }).actualQuantity,
      ).toBe(5);

      expect(() =>
        evaluateOrderAcceptance({
          settings: settings({ minimumOrderQuantity: 5 }),
          currentDateOverride: null,
          previousDateOverride: null,
          evaluatedAt: tehranInstant('2026-08-25', 12, 0),
          normalizedLines: [{ quantity: 2 }, { quantity: 2 }],
        }),
      ).toThrow(OrderMinimumQuantityNotMetError);
    });
  });

  describe('quantity helpers', () => {
    it('sums normalized quantities with checked arithmetic', () => {
      expect(
        sumNormalizedOrderQuantities([{ quantity: 2 }, { quantity: 3 }]),
      ).toBe(5);
      expect(() => sumNormalizedOrderQuantities([])).toThrow(
        OrderingPolicyUnavailableError,
      );
      expect(() =>
        sumNormalizedOrderQuantities([
          { quantity: 2_147_483_647 },
          { quantity: 1 },
        ]),
      ).toThrow(OrderingPolicyUnavailableError);
    });

    it('computes previousLocalDate across month boundaries', () => {
      expect(previousLocalDate('2026-03-01')).toBe('2026-02-28');
      expect(previousLocalDate('2026-01-01')).toBe('2025-12-31');
    });
  });
});
