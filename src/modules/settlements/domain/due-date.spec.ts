import { parseSettlementDueAt } from './due-date';
import { SettlementInvalidDueDateError } from './settlement-errors';

describe('parseSettlementDueAt', () => {
  it('accepts absolute UTC and offset instants including past dates', () => {
    expect(parseSettlementDueAt('2020-01-01T00:00:00Z').toISOString()).toBe(
      '2020-01-01T00:00:00.000Z',
    );
    expect(
      parseSettlementDueAt('2026-08-27T12:30:00+03:30').toISOString(),
    ).toBe('2026-08-27T09:00:00.000Z');
  });

  it.each(['', '2026-08-27', '2026-08-27T12:30:00', 'not-a-date'])(
    'rejects non-absolute or malformed input %p',
    (value) => {
      expect(() => parseSettlementDueAt(value)).toThrow(
        SettlementInvalidDueDateError,
      );
    },
  );
});
