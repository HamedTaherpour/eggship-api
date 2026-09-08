export interface StoredObject {
  storageKey: string;
}

export interface PutObjectInput {
  storageKey: string;
  body: Buffer;
  mimeType: string;
}

export type SignedReadPurpose = 'PUBLIC_REDIRECT' | 'SENSITIVE_ADMIN';
export interface SignedReadUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Provider-independent object storage port.
 * Application/Media code must not import S3/Liara SDKs.
 */
export interface StorageProvider {
  put(input: PutObjectInput): Promise<StoredObject>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getPublicUrl(storageKey: string): string;
  createSignedReadUrl(
    storageKey: string,
    options: { purpose: SignedReadPurpose; expiresInSeconds: number },
  ): Promise<SignedReadUrl>;
}

/** Safe, non-leaking failure from a storage adapter. */
export class StorageProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StorageProviderError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
