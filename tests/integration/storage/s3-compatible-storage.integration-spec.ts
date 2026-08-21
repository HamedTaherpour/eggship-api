import { S3CompatibleStorageProvider } from '../../../src/infrastructure/storage/s3-compatible-storage.provider';
import { jpegFixture } from '../../../src/modules/media/domain/media-test-fixtures';
import { generateMediaStorageKey } from '../../../src/modules/media/domain/storage-key';

/**
 * Opt-in live S3-compatible storage suite (`pnpm test:integration:storage`).
 * Never runs in ordinary CI. Never target a production bucket.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`${name} is required for the storage integration suite.`);
  }
  return value;
}

describe('S3-compatible storage (opt-in live)', () => {
  it('puts, heads, and deletes an object using a generated Media key', async () => {
    const provider = new S3CompatibleStorageProvider({
      endpoint: required('TEST_STORAGE_ENDPOINT'),
      region: process.env['TEST_STORAGE_REGION']?.trim() || 'us-east-1',
      bucket: required('TEST_STORAGE_BUCKET'),
      accessKey: required('TEST_STORAGE_ACCESS_KEY'),
      secretKey: required('TEST_STORAGE_SECRET_KEY'),
      publicBaseUrl:
        process.env['TEST_STORAGE_PUBLIC_BASE_URL']?.trim() ||
        'https://media.test.invalid',
      forcePathStyle: true,
    });

    const storageKey = generateMediaStorageKey('image/jpeg');

    await provider.put({
      storageKey,
      body: jpegFixture(),
      mimeType: 'image/jpeg',
    });
    expect(await provider.exists(storageKey)).toBe(true);
    await provider.delete(storageKey);
    expect(await provider.exists(storageKey)).toBe(false);
    await expect(provider.delete(storageKey)).resolves.toBeUndefined();
  });
});
