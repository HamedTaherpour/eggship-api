import { InMemoryStorageProvider } from './in-memory-storage.provider';

describe('InMemoryStorageProvider', () => {
  it('stores, exists, urls, and deletes without using the filesystem', async () => {
    const storage = new InMemoryStorageProvider('https://media.test.invalid');
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';
    await storage.put({
      storageKey: key,
      body: Buffer.from('abc'),
      mimeType: 'image/jpeg',
    });
    expect(await storage.exists(key)).toBe(true);
    expect(storage.readForTest(key)?.equals(Buffer.from('abc'))).toBe(true);
    expect(storage.getPublicUrl(key)).toBe(`https://media.test.invalid/${key}`);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('creates deterministic signed read URLs for tests', async () => {
    const storage = new InMemoryStorageProvider('https://media.test.invalid');
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';
    const signed = await storage.createSignedReadUrl(key, {
      purpose: 'PUBLIC_REDIRECT',
      expiresInSeconds: 600,
    });
    expect(signed.url).toContain(`https://media.test.invalid/${key}`);
    expect(signed.url).toContain('signed-test=1');
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      600_050,
    );
  });

  it('refuses unsafe keys', async () => {
    const storage = new InMemoryStorageProvider('https://media.test.invalid');
    await expect(
      storage.put({
        storageKey: '../secret.jpg',
        body: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow('safe object key');
  });
});
