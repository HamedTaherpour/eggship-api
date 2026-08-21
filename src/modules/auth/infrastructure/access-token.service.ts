import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { type JwtPayload, TokenExpiredError } from 'jsonwebtoken';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type {
  AccessTokenClaims,
  IssuedAccessToken,
} from '../domain/authenticated-principal';
import {
  AuthSubjectType,
  type AuthSubjectType as SubjectType,
} from '../domain/subject-type';

const ACCESS_TOKEN_USE = 'access';

@Injectable()
export class AccessTokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.ttlSeconds = config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
  }

  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    assertUuid(claims.subjectId, 'subjectId');
    assertUuid(claims.sessionId, 'sessionId');
    assertSubjectType(claims.subjectType);

    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const token = jwt.sign(
      {
        sub: claims.subjectId,
        subjectType: claims.subjectType,
        sessionId: claims.sessionId,
        tokenUse: ACCESS_TOKEN_USE,
      },
      this.secret,
      {
        algorithm: 'HS256',
        expiresIn: this.ttlSeconds,
      },
    );

    return Promise.resolve({ token, expiresAt });
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    if (token.trim() === '') {
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }

    let payload: JwtPayload;
    try {
      const verified = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
      });
      if (typeof verified === 'string' || verified === null) {
        return Promise.reject(
          new AuthError(
            AuthErrorCode.INVALID_TOKEN,
            'Access token is invalid.',
          ),
        );
      }
      payload = verified;
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        return Promise.reject(error);
      }
      if (error instanceof TokenExpiredError) {
        return Promise.reject(
          new AuthError(
            AuthErrorCode.TOKEN_EXPIRED,
            'Access token has expired.',
          ),
        );
      }
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }

    if (readStringClaim(payload, 'tokenUse') !== ACCESS_TOKEN_USE) {
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }

    const subjectId = payload.sub;
    const sessionId = readStringClaim(payload, 'sessionId');
    const subjectType = readStringClaim(payload, 'subjectType');

    if (typeof subjectId !== 'string' || !isUuid(subjectId)) {
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }
    if (sessionId === undefined || !isUuid(sessionId)) {
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }
    if (!isSubjectType(subjectType)) {
      return Promise.reject(
        new AuthError(AuthErrorCode.INVALID_TOKEN, 'Access token is invalid.'),
      );
    }

    return Promise.resolve({
      subjectId,
      subjectType,
      sessionId,
    });
  }
}

function readStringClaim(payload: JwtPayload, key: string): string | undefined {
  const value: unknown = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function assertSubjectType(value: SubjectType): void {
  if (!isSubjectType(value)) {
    throw new Error('subjectType must be USER or ADMIN.');
  }
}

function isSubjectType(value: unknown): value is SubjectType {
  return value === AuthSubjectType.USER || value === AuthSubjectType.ADMIN;
}

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
