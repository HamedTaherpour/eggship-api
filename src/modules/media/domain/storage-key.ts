import { randomUUID } from 'node:crypto';
import {
  MEDIA_EXTENSION_BY_MIME,
  type AcceptedMediaMimeType,
} from './accepted-media-types';

const STORAGE_KEY_PATTERN =
  /^media\/(\d{4})\/(\d{2})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/u;

/**
 * Server-controlled object key. User filenames never become path segments.
 * Layout: media/<utc-year>/<utc-month>/<uuid>.<safe-ext>
 */
export function generateMediaStorageKey(
  mimeType: AcceptedMediaMimeType,
  now: Date = new Date(),
): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extension = MEDIA_EXTENSION_BY_MIME[mimeType];
  return `media/${year}/${month}/${randomUUID()}.${extension}`;
}

export function isMediaStorageKey(value: string): boolean {
  const match = STORAGE_KEY_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}
