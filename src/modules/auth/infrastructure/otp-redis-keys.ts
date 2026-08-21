import { createHash } from 'node:crypto';

/** Versioned OTP key namespace. Do not log these keys. */
export const OTP_REDIS_KEY_PREFIX = 'eggship:auth:otp:v1' as const;

export function otpChallengeKey(challengeId: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:challenge:${challengeId}`;
}

export function otpPhoneActiveKey(phoneFingerprint: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:phone:${phoneFingerprint}:active`;
}

export function otpPhoneCooldownKey(phoneFingerprint: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:phone:${phoneFingerprint}:cooldown`;
}

export function otpPhoneWindowKey(
  phoneFingerprint: string,
  windowId: string,
): string {
  return `${OTP_REDIS_KEY_PREFIX}:phone:${phoneFingerprint}:req:${windowId}`;
}

export function otpIpWindowKey(
  ipFingerprint: string,
  windowId: string,
): string {
  return `${OTP_REDIS_KEY_PREFIX}:ip:${ipFingerprint}:req:${windowId}`;
}

export function otpVerificationGrantKey(grantId: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:grant:${grantId}`;
}

export function otpVerificationGrantConsumedKey(grantId: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:grant-consumed:${grantId}`;
}

/**
 * Fingerprint for Redis key material. Not for logging as a phone substitute in
 * unrestricted diagnostics without review; prefer challengeId in events.
 */
export function fingerprintSensitiveValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function otpWindowBucketId(
  nowUnixMs: number,
  windowSeconds: number,
): string {
  const bucket = Math.floor(nowUnixMs / 1000 / windowSeconds);
  return String(bucket);
}
