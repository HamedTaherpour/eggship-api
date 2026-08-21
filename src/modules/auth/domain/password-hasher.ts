/**
 * Provider-neutral password hashing port.
 * Application code must not import Argon2 directly.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * Returns false for wrong passwords and malformed stored hashes.
   * Does not throw library errors for expected verification failures.
   */
  verify(passwordHash: string, password: string): Promise<boolean>;
}
