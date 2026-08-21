import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3CompatibleStorageProvider } from './s3-compatible-storage.provider';
import { StorageProviderError } from './storage-provider';

describe('S3CompatibleStorageProvider', () => {
  const options = {
    endpoint: 'https://storage.example.invalid',
    region: 'us-east-1',
    bucket: 'eggship-media-test',
    accessKey: 'test-access',
    secretKey: 'test-secret',
    publicBaseUrl: 'https://cdn.example.invalid',
    forcePathStyle: true,
  };

  it('sends PutObject with the server-generated key and no user path', async () => {
    const send = jest.fn().mockResolvedValue({});
    const provider = new S3CompatibleStorageProvider(options, { send });
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';

    await provider.put({
      storageKey: key,
      body: Buffer.from('jpeg-bytes'),
      mimeType: 'image/jpeg',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0] as [PutObjectCommand] | undefined;
    const command = firstCall?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: 'eggship-media-test',
      Key: key,
      ContentType: 'image/jpeg',
    });
    expect(provider.getPublicUrl(key)).toBe(
      `https://cdn.example.invalid/${key}`,
    );
  });

  it('treats a missing object as successful delete so retry can finish', async () => {
    const send = jest.fn().mockRejectedValue({
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    const provider = new S3CompatibleStorageProvider(options, { send });
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';

    await expect(provider.delete(key)).resolves.toBeUndefined();
  });

  it('wraps provider failures without leaking internals', async () => {
    const send = jest.fn().mockRejectedValue(new Error('AccessDenied: secret'));
    const provider = new S3CompatibleStorageProvider(options, { send });
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';

    await expect(
      provider.put({
        storageKey: key,
        body: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(StorageProviderError);
  });
});
