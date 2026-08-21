import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes passwords differently from plaintext', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hasher.hash(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the correct password', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hasher.hash(password);

    await expect(hasher.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hasher.hash('correct-horse-battery-staple');

    await expect(hasher.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false for malformed stored hashes without throwing', async () => {
    await expect(
      hasher.verify('not-a-valid-argon2-hash', 'anything'),
    ).resolves.toBe(false);
  });

  it('rejects empty passwords on hash', async () => {
    await expect(hasher.hash('')).rejects.toThrow(
      'Password must not be empty.',
    );
  });

  it('rejects passwords that exceed the maximum length', async () => {
    const tooLong = 'a'.repeat(129);
    await expect(hasher.hash(tooLong)).rejects.toThrow(
      'Password exceeds maximum allowed length.',
    );
    await expect(hasher.verify('x', tooLong)).resolves.toBe(false);
  });
});
