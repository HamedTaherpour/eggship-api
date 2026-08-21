import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasher } from '../domain/password-hasher';

/**
 * OWASP interactive Argon2id baseline (memory in KiB).
 * Benchmark before production hardening on Liara.
 */
export const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

/** Reject oversized passwords before Argon2 work (DoS bound). */
export const MAX_PASSWORD_LENGTH = 128;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    if (password.length === 0) {
      throw new Error('Password must not be empty.');
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Error('Password exceeds maximum allowed length.');
    }

    return argon2.hash(password, ARGON2ID_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    if (
      passwordHash.length === 0 ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return false;
    }

    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
