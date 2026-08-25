import {
  CommerceOverrideMode,
  LOCAL_MINUTE_MAX,
  LOCAL_MINUTE_MIN,
  MINIMUM_ORDER_QUANTITY_MAX,
  MINIMUM_ORDER_QUANTITY_MIN,
  type CommerceScheduleOverrideRecord,
  type CommerceSettingsRecord,
} from './commerce-policy';
import {
  OrderingClosedError,
  OrderingPolicyUnavailableError,
  OrderMinimumQuantityNotMetError,
} from './commerce-policy-errors';

/** Immutable V1 business timezone (ADR 0016). Not Admin-editable. */
export const COMMERCE_BUSINESS_TIMEZONE = 'Asia/Tehran';

export interface TehranLocalWallClock {
  /** Asia/Tehran calendar date as YYYY-MM-DD. */
  localDate: string;
  /** Minutes since local midnight in [0, 1439]. */
  localMinute: number;
}

export interface OrderAcceptanceLineQuantity {
  quantity: number;
}

export interface OrderAcceptanceEvaluationInput {
  settings: CommerceSettingsRecord | null;
  currentDateOverride: CommerceScheduleOverrideRecord | null;
  previousDateOverride: CommerceScheduleOverrideRecord | null;
  evaluatedAt: Date;
  normalizedLines: readonly OrderAcceptanceLineQuantity[];
}

export interface OrderAcceptanceEvaluationResult {
  revision: number;
  evaluatedAt: Date;
  minimumOrderQuantity: number;
  actualQuantity: number;
  localDate: string;
  localMinute: number;
}

/**
 * Convert a UTC instant to Asia/Tehran local calendar date and wall-clock minute.
 * Seconds/fractions are truncated to minute precision for schedule comparison.
 */
export function toTehranLocalWallClock(instant: Date): TehranLocalWallClock {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new OrderingPolicyUnavailableError();
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: COMMERCE_BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new OrderingPolicyUnavailableError();
  }

  const localDate = `${year}-${month}-${day}`;
  const localMinute = Number(hour) * 60 + Number(minute);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(localDate) ||
    !Number.isInteger(localMinute) ||
    localMinute < LOCAL_MINUTE_MIN ||
    localMinute > LOCAL_MINUTE_MAX
  ) {
    throw new OrderingPolicyUnavailableError();
  }

  return { localDate, localMinute };
}

/** Previous Asia/Tehran calendar date (UTC-midnight ISO arithmetic on date-only). */
export function previousLocalDate(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== localDate
  ) {
    throw new OrderingPolicyUnavailableError();
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Half-open regular-window membership, including daily cross-midnight windows.
 * Same-day: [opensAt, closesAt). Cross-midnight: [opensAt, 1440) ∪ [0, closesAt).
 */
export function isWithinRegularWindow(
  localMinute: number,
  opensAtLocalMinute: number,
  closesAtLocalMinute: number,
): boolean {
  assertDistinctMinutes(opensAtLocalMinute, closesAtLocalMinute);
  if (opensAtLocalMinute < closesAtLocalMinute) {
    return (
      localMinute >= opensAtLocalMinute && localMinute < closesAtLocalMinute
    );
  }
  return localMinute >= opensAtLocalMinute || localMinute < closesAtLocalMinute;
}

/**
 * SPECIAL_HOURS membership on the override's anchor local date.
 * Cross-midnight only covers the evening portion on the anchor date
 * ([opensAt, 1440)); the after-midnight tail belongs to the next date.
 */
export function isWithinSpecialHoursOnAnchorDate(
  localMinute: number,
  opensAtLocalMinute: number,
  closesAtLocalMinute: number,
): boolean {
  assertDistinctMinutes(opensAtLocalMinute, closesAtLocalMinute);
  if (opensAtLocalMinute < closesAtLocalMinute) {
    return (
      localMinute >= opensAtLocalMinute && localMinute < closesAtLocalMinute
    );
  }
  return localMinute >= opensAtLocalMinute;
}

/**
 * Unexpired after-midnight tail of a preceding-date cross-midnight SPECIAL_HOURS.
 */
export function isWithinPreviousSpecialHoursTail(
  localMinute: number,
  opensAtLocalMinute: number,
  closesAtLocalMinute: number,
): boolean {
  assertDistinctMinutes(opensAtLocalMinute, closesAtLocalMinute);
  if (opensAtLocalMinute < closesAtLocalMinute) {
    return false;
  }
  return localMinute < closesAtLocalMinute;
}

export function sumNormalizedOrderQuantities(
  lines: readonly OrderAcceptanceLineQuantity[],
): number {
  if (lines.length === 0) {
    throw new OrderingPolicyUnavailableError();
  }

  let sum = 0;
  for (const line of lines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < MINIMUM_ORDER_QUANTITY_MIN ||
      line.quantity > MINIMUM_ORDER_QUANTITY_MAX
    ) {
      throw new OrderingPolicyUnavailableError();
    }
    const next = sum + line.quantity;
    if (
      next > MINIMUM_ORDER_QUANTITY_MAX ||
      next < sum ||
      !Number.isSafeInteger(next)
    ) {
      throw new OrderingPolicyUnavailableError();
    }
    sum = next;
  }
  return sum;
}

/**
 * Pure Order-acceptance evaluation (ADR 0016).
 * Callers must supply one coherent committed policy snapshot and one evaluation instant.
 */
export function evaluateOrderAcceptance(
  input: OrderAcceptanceEvaluationInput,
): OrderAcceptanceEvaluationResult {
  const settings = requireValidSettings(input.settings);
  const { localDate, localMinute } = toTehranLocalWallClock(input.evaluatedAt);
  const previousDate = previousLocalDate(localDate);

  const current = requireValidOverrideForDate(
    input.currentDateOverride,
    localDate,
  );
  const previous = requireValidOverrideForDate(
    input.previousDateOverride,
    previousDate,
  );

  if (!isOrderingOpenAt(settings, current, previous, localMinute)) {
    throw new OrderingClosedError();
  }

  const actualQuantity = sumNormalizedOrderQuantities(input.normalizedLines);
  if (actualQuantity < settings.minimumOrderQuantity) {
    throw new OrderMinimumQuantityNotMetError(
      settings.minimumOrderQuantity,
      actualQuantity,
    );
  }

  return {
    revision: settings.revision,
    evaluatedAt: input.evaluatedAt,
    minimumOrderQuantity: settings.minimumOrderQuantity,
    actualQuantity,
    localDate,
    localMinute,
  };
}

function isOrderingOpenAt(
  settings: CommerceSettingsRecord,
  current: CommerceScheduleOverrideRecord | null,
  previous: CommerceScheduleOverrideRecord | null,
  localMinute: number,
): boolean {
  if (current !== null) {
    if (current.mode === CommerceOverrideMode.CLOSED) {
      return false;
    }
    return isWithinSpecialHoursOnAnchorDate(
      localMinute,
      current.opensAtLocalMinute!,
      current.closesAtLocalMinute!,
    );
  }

  if (
    previous !== null &&
    previous.mode === CommerceOverrideMode.SPECIAL_HOURS &&
    isWithinPreviousSpecialHoursTail(
      localMinute,
      previous.opensAtLocalMinute!,
      previous.closesAtLocalMinute!,
    )
  ) {
    return true;
  }

  if (!settings.orderingScheduleEnabled) {
    return true;
  }

  return isWithinRegularWindow(
    localMinute,
    settings.orderingOpensAtLocalMinute,
    settings.orderingClosesAtLocalMinute,
  );
}

function requireValidSettings(
  settings: CommerceSettingsRecord | null,
): CommerceSettingsRecord {
  if (settings === null) {
    throw new OrderingPolicyUnavailableError();
  }
  if (
    !Number.isInteger(settings.revision) ||
    settings.revision < 1 ||
    !validMinute(settings.orderingOpensAtLocalMinute) ||
    !validMinute(settings.orderingClosesAtLocalMinute) ||
    settings.orderingOpensAtLocalMinute ===
      settings.orderingClosesAtLocalMinute ||
    !Number.isInteger(settings.minimumOrderQuantity) ||
    settings.minimumOrderQuantity < MINIMUM_ORDER_QUANTITY_MIN ||
    settings.minimumOrderQuantity > MINIMUM_ORDER_QUANTITY_MAX
  ) {
    throw new OrderingPolicyUnavailableError();
  }
  return settings;
}

function requireValidOverrideForDate(
  override: CommerceScheduleOverrideRecord | null,
  expectedLocalDate: string,
): CommerceScheduleOverrideRecord | null {
  if (override === null) {
    return null;
  }
  if (override.localDate !== expectedLocalDate) {
    throw new OrderingPolicyUnavailableError();
  }
  if (override.mode === CommerceOverrideMode.CLOSED) {
    if (
      override.opensAtLocalMinute !== null ||
      override.closesAtLocalMinute !== null
    ) {
      throw new OrderingPolicyUnavailableError();
    }
    return override;
  }
  if (override.mode !== CommerceOverrideMode.SPECIAL_HOURS) {
    throw new OrderingPolicyUnavailableError();
  }
  if (
    override.opensAtLocalMinute === null ||
    override.closesAtLocalMinute === null ||
    !validMinute(override.opensAtLocalMinute) ||
    !validMinute(override.closesAtLocalMinute) ||
    override.opensAtLocalMinute === override.closesAtLocalMinute
  ) {
    throw new OrderingPolicyUnavailableError();
  }
  return override;
}

function assertDistinctMinutes(opensAt: number, closesAt: number): void {
  if (!validMinute(opensAt) || !validMinute(closesAt) || opensAt === closesAt) {
    throw new OrderingPolicyUnavailableError();
  }
}

function validMinute(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= LOCAL_MINUTE_MIN &&
    value <= LOCAL_MINUTE_MAX
  );
}
