import { isSafeObjectKey, joinPublicObjectUrl } from './object-key';

describe('object-key safety', () => {
  it('rejects traversal, absolute paths, and empty segments', () => {
    expect(isSafeObjectKey('media/2026/08/a.jpg')).toBe(true);
    expect(isSafeObjectKey('../etc/passwd')).toBe(false);
    expect(isSafeObjectKey('/abs/path')).toBe(false);
    expect(isSafeObjectKey('media\\evil')).toBe(false);
    expect(isSafeObjectKey('https://evil.example/x')).toBe(false);
    expect(isSafeObjectKey('media//x.jpg')).toBe(false);
  });

  it('joins a public base URL without duplicating slashes', () => {
    expect(
      joinPublicObjectUrl(
        'https://cdn.example.invalid/',
        'media/2026/08/a.jpg',
      ),
    ).toBe('https://cdn.example.invalid/media/2026/08/a.jpg');
  });
});
