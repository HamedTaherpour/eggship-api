/**
 * Admin password-login abuse windows (ADM-AUTH-01).
 *
 * Limits are code constants rather than a new env surface: Admin login is a
 * high-value target, and these starting points can become configuration later
 * without changing the key layout. Redis is authoritative when configured;
 * production without Redis fails closed. Development/test may use an in-process
 * limiter so ordinary e2e stays network-independent.
 */

/** Per canonical-email fingerprint window. */
export const ADMIN_LOGIN_EMAIL_WINDOW_SECONDS = 900;
export const ADMIN_LOGIN_EMAIL_WINDOW_LIMIT = 5;

/** Per request-source IP window. */
export const ADMIN_LOGIN_IP_WINDOW_SECONDS = 900;
export const ADMIN_LOGIN_IP_WINDOW_LIMIT = 20;

export const ADMIN_LOGIN_ABUSE_KEY_PREFIX = 'eggship:admin:auth:login:v1';

export interface AdminLoginAbuseConsumeInput {
  /** HMAC fingerprint of the canonical email, never the email itself. */
  emailFingerprint: string;
  clientIp?: string;
}

export interface AdminLoginAbuseDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface AdminLoginAbuseLimiter {
  consume(input: AdminLoginAbuseConsumeInput): Promise<AdminLoginAbuseDecision>;
}
