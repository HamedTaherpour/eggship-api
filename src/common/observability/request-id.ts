import { randomUUID } from 'node:crypto';

const MAX_REQUEST_ID_LENGTH = 128;
const TRUSTED_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function createRequestId(): string {
  return `req_${randomUUID()}`;
}

export function resolveRequestId(inboundValue: string | undefined): string {
  const candidate = inboundValue?.trim();
  if (
    candidate !== undefined &&
    candidate.length <= MAX_REQUEST_ID_LENGTH &&
    TRUSTED_REQUEST_ID_PATTERN.test(candidate)
  ) {
    return candidate;
  }
  return createRequestId();
}
