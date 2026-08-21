import { generateMediaStorageKey, isMediaStorageKey } from './storage-key';
import { derivePublicMediaUrl, isSafePublicBaseUrl } from './public-media-url';

describe('media storage keys', () => {
  it('generates collision-resistant keys under media/<year>/<month>/', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const key = generateMediaStorageKey('image/jpeg', now);
    expect(key).toMatch(/^media\/2026\/08\/[0-9a-f-]{36}\.jpg$/u);
    expect(isMediaStorageKey(key)).toBe(true);
    expect(key).not.toContain('..');
    expect(key.includes('\\')).toBe(false);
  });

  it('derives the extension from detected type, not the user filename', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    expect(generateMediaStorageKey('image/png', now)).toMatch(/\.png$/u);
    expect(generateMediaStorageKey('image/webp', now)).toMatch(/\.webp$/u);
  });

  it('rejects traversal and user-controlled keys', () => {
    expect(isMediaStorageKey('../secret.jpg')).toBe(false);
    expect(isMediaStorageKey('media/2026/08/not-a-uuid.jpg')).toBe(false);
    expect(
      isMediaStorageKey(
        'media/2026/13/11111111-1111-4111-8111-111111111111.jpg',
      ),
    ).toBe(false);
  });

  it('derives public URLs from base + key without credentials', () => {
    const key = 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg';
    expect(derivePublicMediaUrl('https://cdn.example.invalid/', key)).toBe(
      `https://cdn.example.invalid/${key}`,
    );
    expect(isSafePublicBaseUrl('https://user:pass@cdn.example.invalid')).toBe(
      false,
    );
  });
});
