import { MAX_PASSWORD_LENGTH } from '../../auth/infrastructure/argon2-password-hasher';
import {
  assertAdminPasswordPolicy,
  MAX_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
  WeakAdminPasswordError,
} from './admin-password-policy';

describe('assertAdminPasswordPolicy', () => {
  it('accepts a password at the minimum length', () => {
    expect(() =>
      assertAdminPasswordPolicy('a'.repeat(MIN_ADMIN_PASSWORD_LENGTH)),
    ).not.toThrow();
  });

  it('rejects a password one character below the minimum', () => {
    expect(() =>
      assertAdminPasswordPolicy('a'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1)),
    ).toThrow(WeakAdminPasswordError);
  });

  it('rejects an empty password', () => {
    expect(() => assertAdminPasswordPolicy('')).toThrow(WeakAdminPasswordError);
  });

  it('accepts a long passphrase with no character-class variety', () => {
    // Length-oriented policy: composition rules are deliberately not imposed.
    expect(() =>
      assertAdminPasswordPolicy('correct horse battery staple'),
    ).not.toThrow();
  });

  it('rejects a password beyond the hashing bound', () => {
    expect(() =>
      assertAdminPasswordPolicy('a'.repeat(MAX_ADMIN_PASSWORD_LENGTH + 1)),
    ).toThrow(WeakAdminPasswordError);
  });

  it('never allows a password the Argon2 hasher would refuse', () => {
    // Drift guard: policy must not accept input that the hasher rejects, or a
    // valid-by-policy password would fail with a raw infrastructure error.
    expect(MAX_ADMIN_PASSWORD_LENGTH).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
  });

  it('does not disclose the candidate password in its error', () => {
    const password = 'short';
    try {
      assertAdminPasswordPolicy(password);
      throw new Error('expected a policy failure');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(WeakAdminPasswordError);
      expect((error as Error).message).not.toContain(password);
    }
  });
});
