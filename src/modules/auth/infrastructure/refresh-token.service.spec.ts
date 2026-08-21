import { randomUUID } from 'node:crypto';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { digestRefreshToken } from '../domain/refresh-token-digest';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const service = new RefreshTokenService();

  it('issues opaque high-entropy tokens with matching digests', () => {
    const sessionId = randomUUID();
    const first = service.issueRefreshToken(sessionId);
    const second = service.issueRefreshToken(sessionId);

    expect(first.rawToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/iu);
    expect(first.sessionId).toBe(sessionId);
    expect(first.digest).toBe(digestRefreshToken(first.rawToken));
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.digest).not.toBe(second.digest);
  });

  it('parses session routing without trusting digest alone', () => {
    const sessionId = randomUUID();
    const issued = service.issueRefreshToken(sessionId);
    const parsed = service.parseRefreshToken(issued.rawToken);

    expect(parsed.sessionId).toBe(sessionId);
  });

  it('rejects malformed refresh tokens safely', () => {
    expect(() => service.parseRefreshToken('nope')).toThrow(AuthError);
    try {
      service.parseRefreshToken('nope');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe(AuthErrorCode.INVALID_TOKEN);
      expect((error as AuthError).message).toBe('Refresh token is invalid.');
    }

    expect(() => service.parseRefreshToken(`${randomUUID()}.short`)).toThrow(
      AuthError,
    );
  });

  it('does not include token material in error messages', () => {
    const raw = service.issueRefreshToken(randomUUID()).rawToken;
    try {
      service.parseRefreshToken('bad-token-value');
      throw new Error('expected parse failure');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(raw);
      expect(message).not.toContain('bad-token-value');
    }
  });
});
