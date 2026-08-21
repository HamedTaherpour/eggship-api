export const ORIGINAL_FILE_NAME_MAX_LENGTH = 255;

/**
 * Sanitize a client filename for metadata storage only.
 * Never use the result as a storage path or object-key segment.
 */
export function sanitizeOriginalFileName(raw: string | undefined): string {
  const source = raw ?? '';
  const withoutNulls = source.replaceAll('\0', '');
  const segments = withoutNulls.split(/[/\\]/u);
  const base = segments[segments.length - 1] ?? '';
  const stripped = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();

  if (stripped === '' || stripped === '.' || stripped === '..') {
    return 'unnamed';
  }

  if (stripped.length <= ORIGINAL_FILE_NAME_MAX_LENGTH) {
    return stripped;
  }
  return stripped.slice(0, ORIGINAL_FILE_NAME_MAX_LENGTH);
}
