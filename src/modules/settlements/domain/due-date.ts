import { SettlementInvalidDueDateError } from './settlement-errors';

const ABSOLUTE_ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export function parseSettlementDueAt(value: string): Date {
  if (!ABSOLUTE_ISO_INSTANT.test(value)) {
    throw new SettlementInvalidDueDateError();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SettlementInvalidDueDateError();
  }
  return parsed;
}
