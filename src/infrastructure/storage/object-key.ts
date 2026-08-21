/**
 * Generic object-key safety for the storage port.
 * Media generates keys; storage refuses traversal and absolute paths.
 */
export function isSafeObjectKey(storageKey: string): boolean {
  if (storageKey === '' || storageKey.includes('\0')) {
    return false;
  }
  if (storageKey.startsWith('/') || storageKey.includes('\\')) {
    return false;
  }
  if (storageKey.includes('..')) {
    return false;
  }
  if (storageKey.includes('://')) {
    return false;
  }
  return !storageKey.split('/').some((segment) => segment === '');
}

export function joinPublicObjectUrl(
  publicBaseUrl: string,
  storageKey: string,
): string {
  if (!isSafeObjectKey(storageKey)) {
    throw new Error('Refusing to derive a URL for an unsafe storage key.');
  }
  const base = publicBaseUrl.trim().replace(/\/+$/u, '');
  return `${base}/${storageKey}`;
}
