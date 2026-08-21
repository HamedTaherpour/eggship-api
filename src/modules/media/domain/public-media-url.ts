import { isMediaStorageKey } from './storage-key';

/**
 * Derive a public object URL from configured base + server-generated key.
 * Do not persist environment-specific URLs. Credentials must never appear here.
 */
export function derivePublicMediaUrl(
  publicBaseUrl: string,
  storageKey: string,
): string {
  if (!isMediaStorageKey(storageKey)) {
    throw new Error('Refusing to derive a URL for an invalid storage key.');
  }
  const base = publicBaseUrl.trim().replace(/\/+$/u, '');
  return `${base}/${storageKey}`;
}

export function isSafePublicBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    if (url.hostname === '') {
      return false;
    }
    if (url.username !== '' || url.password !== '') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
