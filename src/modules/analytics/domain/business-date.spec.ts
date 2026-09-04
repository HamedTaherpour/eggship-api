import { resolveAnalyticsDateRange } from './business-date';
import {
  AnalyticsInvalidDateRangeError,
  AnalyticsRangeTooLargeError,
} from './analytics-errors';

describe('analytics business dates', () => {
  it('converts a Tehran day to a half-open UTC range', () => {
    const range = resolveAnalyticsDateRange('2026-01-01', '2026-01-01');
    expect(range.start.toISOString()).toBe('2025-12-31T20:30:00.000Z');
    expect(range.end.toISOString()).toBe('2026-01-01T20:30:00.000Z');
  });

  it('supports month, year, and leap-day boundaries', () => {
    expect(resolveAnalyticsDateRange('2024-02-29', '2024-03-01').dates).toEqual(
      ['2024-02-29', '2024-03-01'],
    );
    expect(resolveAnalyticsDateRange('2025-12-31', '2026-01-01').dates).toEqual(
      ['2025-12-31', '2026-01-01'],
    );
  });

  it('rejects invalid, reversed, and oversized ranges', () => {
    expect(() => resolveAnalyticsDateRange('2025-02-29', '2025-03-01')).toThrow(
      AnalyticsInvalidDateRangeError,
    );
    expect(() => resolveAnalyticsDateRange('2026-01-02', '2026-01-01')).toThrow(
      AnalyticsInvalidDateRangeError,
    );
    expect(() => resolveAnalyticsDateRange('2026-01-01', '2027-01-02')).toThrow(
      AnalyticsRangeTooLargeError,
    );
  });
});
