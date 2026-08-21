/**
 * Authenticated subject category carried in tokens and sessions.
 * User (store) and Admin must never be conflated.
 */
export const AuthSubjectType = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export type AuthSubjectType =
  (typeof AuthSubjectType)[keyof typeof AuthSubjectType];
