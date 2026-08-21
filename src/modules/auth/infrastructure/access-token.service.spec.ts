import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import { AuthSubjectType } from '../domain/subject-type';
import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  const secret = 'unit-test-jwt-access-secret-32chars!!';
  const service = new AccessTokenService(
    createConfig({
      JWT_ACCESS_SECRET: secret,
      JWT_ACCESS_TTL_SECONDS: 60,
    }),
  );

  const claims = {
    subjectId: randomUUID(),
    subjectType: AuthSubjectType.USER,
    sessionId: randomUUID(),
  };

  it('issues and verifies a valid access token', async () => {
    const issued = await service.issueAccessToken(claims);
    const verified = await service.verifyAccessToken(issued.token);

    expect(verified).toEqual(claims);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects expired tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: claims.subjectId,
        subjectType: claims.subjectType,
        sessionId: claims.sessionId,
        tokenUse: 'access',
        iat: now - 120,
        exp: now - 60,
      },
      secret,
      {
        algorithm: 'HS256',
      },
    );

    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: AuthErrorCode.TOKEN_EXPIRED,
    });
  });

  it('rejects tokens signed with the wrong secret', async () => {
    const other = new AccessTokenService(
      createConfig({
        JWT_ACCESS_SECRET: 'different-jwt-access-secret-32chars!',
        JWT_ACCESS_TTL_SECONDS: 60,
      }),
    );
    const issued = await service.issueAccessToken(claims);

    await expect(other.verifyAccessToken(issued.token)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('rejects malformed tokens without leaking internals', async () => {
    await expect(service.verifyAccessToken('not.a.jwt')).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
      message: 'Access token is invalid.',
    });
  });

  it('rejects tokens missing required claims', async () => {
    const token = jwt.sign({ tokenUse: 'access' }, secret, {
      algorithm: 'HS256',
      expiresIn: 120,
    });

    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
    });
  });

  it('rejects non-access tokenUse values', async () => {
    const token = jwt.sign(
      {
        sub: claims.subjectId,
        subjectType: claims.subjectType,
        sessionId: claims.sessionId,
        tokenUse: 'refresh',
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: 120,
      },
    );

    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_TOKEN,
    });
  });

  it('issues and verifies an ADMIN access token', async () => {
    const adminClaims = {
      subjectId: randomUUID(),
      subjectType: AuthSubjectType.ADMIN,
      sessionId: randomUUID(),
    };
    const issued = await service.issueAccessToken(adminClaims);
    const verified = await service.verifyAccessToken(issued.token);

    expect(verified).toEqual(adminClaims);
  });
});

function createConfig(values: Record<string, string | number>): ConfigService {
  return {
    getOrThrow: (key: string): string | number => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`${key} is required.`);
      }
      return value;
    },
  } as ConfigService;
}
