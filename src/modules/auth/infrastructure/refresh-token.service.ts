import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type {
  IssuedRefreshToken,
  ParsedRefreshToken,
} from '../domain/refresh-token';
import { digestRefreshToken } from '../domain/refresh-token-digest';

/** Opaque secret length in bytes (256-bit entropy). */
const REFRESH_SECRET_BYTES = 32;

/**
 * Issues and parses opaque refresh tokens of the form `sessionId.secret`.
 * Tokens are not JWTs; only the SHA-256 digest is persisted.
 */
@Injectable()
export class RefreshTokenService {
  issueRefreshToken(sessionId: string): IssuedRefreshToken {
    if (!isUuid(sessionId)) {
      throw new Error('sessionId must be a UUID.');
    }

    const secret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    const rawToken = `${sessionId}.${secret}`;
    const digest = digestRefreshToken(rawToken);

    return {
      rawToken,
      digest,
      sessionId,
    };
  }

  /**
   * Parses the session routing id from an opaque refresh token.
   * Callers must hash the full raw token and verify AuthSession state.
   */
  parseRefreshToken(rawToken: string): ParsedRefreshToken {
    const trimmed = rawToken.trim();
    const separatorIndex = trimmed.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Refresh token is invalid.',
      );
    }

    const sessionId = trimmed.slice(0, separatorIndex);
    const secret = trimmed.slice(separatorIndex + 1);

    if (!isUuid(sessionId) || !isOpaqueSecret(secret)) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'Refresh token is invalid.',
      );
    }

    return { sessionId };
  }

  digest(rawToken: string): string {
    return digestRefreshToken(rawToken);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function isOpaqueSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}
