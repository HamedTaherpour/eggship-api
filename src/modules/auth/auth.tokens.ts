/**
 * Injection tokens for Auth infrastructure ports.
 */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const OTP_STORE = Symbol('OTP_STORE');
export const OTP_VERIFICATION_GRANT_STORE = Symbol(
  'OTP_VERIFICATION_GRANT_STORE',
);
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const OTP_CODE_ISSUER = Symbol('OTP_CODE_ISSUER');
