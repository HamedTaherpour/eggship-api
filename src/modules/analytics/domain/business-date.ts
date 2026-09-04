import {
  AnalyticsInvalidDateRangeError,
  AnalyticsRangeTooLargeError,
} from './analytics-errors';

export const ANALYTICS_TIME_ZONE = 'Asia/Tehran';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface AnalyticsDateRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
  dates: string[];
  boundaries: Date[];
}

export function resolveAnalyticsTodayRange(
  now = new Date(),
): AnalyticsDateRange {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  return resolveAnalyticsDateRange(date, date);
}

export function resolveAnalyticsDateRange(
  from: string,
  to: string,
): AnalyticsDateRange {
  const fromParts = parseLocalDate(from);
  const toParts = parseLocalDate(to);
  const fromDay = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
  const toDay = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
  if (fromDay > toDay)
    throw new AnalyticsInvalidDateRangeError('`from` must not be after `to`.');
  const count = Math.floor((toDay - fromDay) / 86_400_000) + 1;
  if (count > 366) throw new AnalyticsRangeTooLargeError();
  const dates: string[] = [];
  const boundaries: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const parts = i === 0 ? fromParts : addDays(fromParts, i);
    dates.push(formatDate(new Date(fromDay + i * 86_400_000)));
    boundaries.push(tehranMidnight(parts));
  }
  const end = tehranMidnight(addDay(toParts));
  boundaries.push(end);
  return { from, to, start: boundaries[0]!, end, dates, boundaries };
}

type DateParts = { year: number; month: number; day: number };

function parseLocalDate(value: string): DateParts {
  const match = DATE_PATTERN.exec(value);
  if (match === null)
    throw new AnalyticsInvalidDateRangeError('Dates must use YYYY-MM-DD.');
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    throw new AnalyticsInvalidDateRangeError(
      'The requested date is not a valid calendar date.',
    );
  }
  return parts;
}

function addDay(parts: DateParts): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + 86_400_000,
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addDays(parts: DateParts, count: number): DateParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + count * 86_400_000,
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function tehranMidnight(parts: DateParts): Date {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = localAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: ANALYTICS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(
      formatted.map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    candidate = localAsUtc - (representedUtc - candidate);
  }
  return new Date(candidate);
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`;
}
