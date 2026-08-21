import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { isSafeObjectKey, joinPublicObjectUrl } from './object-key';
import type {
  PutObjectInput,
  StorageProvider,
  StoredObject,
} from './storage-provider';
import { StorageProviderError } from './storage-provider';

export interface S3CompatibleStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
}

export type S3CompatibleClient = Pick<S3Client, 'send'>;

/**
 * S3-compatible object storage (including Liara Object Storage).
 * Endpoint, bucket, and credentials come from typed environment config.
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  constructor(
    private readonly options: S3CompatibleStorageOptions,
    private readonly client: S3CompatibleClient = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    }),
  ) {}

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertSafeKey(input.storageKey);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: input.storageKey,
          Body: input.body,
          ContentType: input.mimeType,
          ContentLength: input.body.length,
        }),
      );
    } catch (error: unknown) {
      throw wrapProviderError('put', error);
    }
    return { storageKey: input.storageKey };
  }

  async delete(storageKey: string): Promise<void> {
    assertSafeKey(storageKey);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.options.bucket,
          Key: storageKey,
        }),
      );
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return;
      }
      throw wrapProviderError('delete', error);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    assertSafeKey(storageKey);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: storageKey,
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return false;
      }
      throw wrapProviderError('exists', error);
    }
  }

  getPublicUrl(storageKey: string): string {
    return joinPublicObjectUrl(this.options.publicBaseUrl, storageKey);
  }
}

function assertSafeKey(storageKey: string): void {
  if (!isSafeObjectKey(storageKey)) {
    throw new Error('Storage key is not a safe object key.');
  }
}

function wrapProviderError(operation: string, error: unknown): Error {
  return new StorageProviderError(`Object storage ${operation} failed.`, {
    cause: error,
  });
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error ? error.name : undefined;
  const metadata =
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null
      ? error.$metadata
      : undefined;
  const httpStatus =
    metadata !== undefined && 'httpStatusCode' in metadata
      ? metadata.httpStatusCode
      : undefined;
  return name === 'NotFound' || name === 'NoSuchKey' || httpStatus === 404;
}
