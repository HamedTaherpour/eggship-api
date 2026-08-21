import type { AuthSubjectType } from './subject-type';

/**
 * Minimal authenticated principal for guards/controllers.
 * No profile, phone, or permission payloads.
 */
export interface AuthenticatedPrincipal {
  subjectId: string;
  subjectType: AuthSubjectType;
  sessionId: string;
}

export interface AccessTokenClaims {
  subjectId: string;
  subjectType: AuthSubjectType;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}
