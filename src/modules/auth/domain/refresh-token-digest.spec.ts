import {
  digestRefreshToken,
  generateRefreshToken,
} from './refresh-token-digest';

describe('digestRefreshToken', () => {
  it('returns a stable base64url SHA-256 digest', () => {
    const token = 'rt_test_high_entropy_value_001';
    const first = digestRefreshToken(token);
    const second = digestRefreshToken(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(first).not.toBe(token);
  });

  it('produces different digests for different tokens', () => {
    expect(digestRefreshToken('token-a')).not.toBe(
      digestRefreshToken('token-b'),
    );
  });

  it('rejects empty tokens', () => {
    expect(() => digestRefreshToken('')).toThrow(
      'Refresh token must not be empty.',
    );
  });
});

describe('generateRefreshToken', () => {
  it('returns opaque base64url material with high entropy', () => {
    const token = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('rejects insufficient entropy requests', () => {
    expect(() => generateRefreshToken(16)).toThrow(
      'Refresh token entropy must be at least 32 bytes.',
    );
  });
});
