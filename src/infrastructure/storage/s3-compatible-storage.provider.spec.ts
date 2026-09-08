import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3CompatibleStorageProvider } from './s3-compatible-storage.provider';
import { StorageProviderError } from './storage-provider';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

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

  beforeEach(() => {
    jest.mocked(getSignedUrl).mockReset();
  });

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

  it('creates provider-signed GET URLs with bounded expiry and no credential leak', async () => {
    const send = jest.fn();
    const provider = new S3CompatibleStorageProvider(options, { send });
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';
    jest
      .mocked(getSignedUrl)
      .mockResolvedValue(
        'https://cdn.example.invalid/media/object?X-Amz-Signature=abc&X-Amz-Expires=300',
      );

    const signed = await provider.createSignedReadUrl(key, {
      purpose: 'SENSITIVE_ADMIN',
      expiresInSeconds: 300,
    });

    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, signing] = jest.mocked(getSignedUrl).mock.calls[0]!;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toMatchObject({
      Bucket: 'eggship-media-test',
      Key: key,
    });
    expect(signing).toEqual({ expiresIn: 300 });
    expect(signed.url).toContain('X-Amz-Signature=');
    expect(signed.url).not.toContain('test-secret');
    expect(signed.url).not.toContain('test-access');
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      350_000,
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
