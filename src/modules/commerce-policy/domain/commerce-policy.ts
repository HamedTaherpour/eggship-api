export const COMMERCE_SETTINGS_SINGLETON_ID = 1;
export const LOCAL_MINUTE_MIN = 0;
export const LOCAL_MINUTE_MAX = 1439;
export const MINIMUM_ORDER_QUANTITY_MIN = 1;
export const MINIMUM_ORDER_QUANTITY_MAX = 2_147_483_647;

export const CommerceOverrideMode = {
  CLOSED: 'CLOSED',
  SPECIAL_HOURS: 'SPECIAL_HOURS',
} as const;
export type CommerceOverrideMode =
  (typeof CommerceOverrideMode)[keyof typeof CommerceOverrideMode];

export interface CommerceSettingsRecord {
  orderingScheduleEnabled: boolean;
  orderingOpensAtLocalMinute: number;
  orderingClosesAtLocalMinute: number;
  minimumOrderQuantity: number;
  revision: number;
  createdByAdminId: string;
  updatedByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommerceScheduleOverrideRecord {
  id: string;
  localDate: string;
  mode: CommerceOverrideMode;
  opensAtLocalMinute: number | null;
  closesAtLocalMinute: number | null;
  createdByAdminId: string;
  updatedByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommerceSettingsInput {
  orderingScheduleEnabled: boolean;
  orderingOpensAtLocalMinute: number;
  orderingClosesAtLocalMinute: number;
  minimumOrderQuantity: number;
}

export interface CommerceOverrideInput {
  mode: CommerceOverrideMode;
  opensAtLocalMinute: number | null;
  closesAtLocalMinute: number | null;
}

export function parseLocalTime(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new Error('INVALID_LOCAL_TIME');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

export function formatLocalTime(value: number): string {
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
