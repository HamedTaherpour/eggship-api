/**
 * Launch allowlist for Admin Media Library uploads.
 *
 * JPEG/PNG/WebP are the evidenced catalog/blog image formats. SVG is excluded
 * because it can carry active content and needs a separate sanitization decision.
 * GIF is excluded until MIG-01 evidences a legacy requirement.
 */
export const ACCEPTED_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AcceptedMediaMimeType = (typeof ACCEPTED_MEDIA_MIME_TYPES)[number];

export const MEDIA_EXTENSION_BY_MIME: Record<AcceptedMediaMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isAcceptedMediaMimeType(
  value: string,
): value is AcceptedMediaMimeType {
  return (ACCEPTED_MEDIA_MIME_TYPES as readonly string[]).includes(value);
}
