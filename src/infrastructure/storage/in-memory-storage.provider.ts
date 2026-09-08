import { isSafeObjectKey, joinPublicObjectUrl } from './object-key';
import type {
  PutObjectInput,
  StorageProvider,
  StoredObject,
} from './storage-provider';
import { StorageProviderError } from './storage-provider';

/**
 * Deterministic in-memory adapter for unit/e2e and local development.
 * Must never be selected when NODE_ENV=production.
 */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly publicBaseUrl: string) {}

  put(input: PutObjectInput): Promise<StoredObject> {
    if (!isSafeObjectKey(input.storageKey)) {
      return Promise.reject(new Error('Storage key is not a safe object key.'));
    }
    this.objects.set(input.storageKey, Buffer.from(input.body));
    return Promise.resolve({ storageKey: input.storageKey });
  }

  delete(storageKey: string): Promise<void> {
    if (!isSafeObjectKey(storageKey)) {
      return Promise.reject(new Error('Storage key is not a safe object key.'));
    }
    this.objects.delete(storageKey);
    return Promise.resolve();
  }

  exists(storageKey: string): Promise<boolean> {
    if (!isSafeObjectKey(storageKey)) {
      return Promise.reject(new Error('Storage key is not a safe object key.'));
    }
    return Promise.resolve(this.objects.has(storageKey));
  }

  getPublicUrl(storageKey: string): string {
    return joinPublicObjectUrl(this.publicBaseUrl, storageKey);
  }

  createSignedReadUrl(
    storageKey: string,
    options: {
      purpose: 'PUBLIC_REDIRECT' | 'SENSITIVE_ADMIN';
      expiresInSeconds: number;
    },
  ): Promise<{ url: string; expiresAt: Date }> {
    if (!isSafeObjectKey(storageKey))
      return Promise.reject(
        new StorageProviderError('Object storage read signing failed.'),
      );
    const expiresAt = new Date(Date.now() + options.expiresInSeconds * 1000);
    return Promise.resolve({
      url: `${this.getPublicUrl(storageKey)}?signed-test=1&expires=${expiresAt.getTime()}`,
      expiresAt,
    });
  }

  /** Test helper: inspect stored bytes without exposing a filesystem. */
  readForTest(storageKey: string): Buffer | undefined {
    return this.objects.get(storageKey);
  }

  clearForTest(): void {
    this.objects.clear();
  }

  countForTest(): number {
    return this.objects.size;
  }
}
