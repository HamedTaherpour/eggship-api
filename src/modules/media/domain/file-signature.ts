import {
  isAcceptedMediaMimeType,
  type AcceptedMediaMimeType,
} from './accepted-media-types';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Detect image type from magic bytes. Client Content-Type and extension are
 * not authoritative. SVG/GIF and other types return undefined.
 */
export function detectMediaMimeType(
  buffer: Buffer,
): AcceptedMediaMimeType | undefined {
  if (buffer.length < 12) {
    return undefined;
  }
  if (hasPrefix(buffer, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  if (hasPrefix(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (isWebp(buffer)) {
    return 'image/webp';
  }
  return undefined;
}

const GENERIC_CLAIMED_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

export function claimedTypeMatchesDetected(
  claimedMimeType: string,
  detected: AcceptedMediaMimeType,
): boolean {
  const normalized = claimedMimeType.trim().toLowerCase();
  const mediaType = normalized.split(';')[0]?.trim() ?? '';
  if (GENERIC_CLAIMED_TYPES.has(mediaType)) {
    return true;
  }
  if (mediaType === detected) {
    return true;
  }
  return detected === 'image/jpeg' && mediaType === 'image/jpg';
}

export function coerceAcceptedMimeType(
  value: string,
): AcceptedMediaMimeType | undefined {
  return isAcceptedMediaMimeType(value) ? value : undefined;
}

function hasPrefix(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.subarray(0, prefix.length).equals(prefix);
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
