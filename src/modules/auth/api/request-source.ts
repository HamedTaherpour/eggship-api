import type { Request } from 'express';
import type { OtpRequestSource } from '../domain/otp-challenge';

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/u;
const IPV6_PATTERN = /^[0-9a-f:]+$/iu;

/**
 * Resolves a conservative request-source IP for OTP abuse controls.
 *
 * Uses Express/`req.ip` (and socket fallback) only. Does **not** parse
 * `X-Forwarded-For` or other forwarding headers directly. Behind a reverse
 * proxy, Nest/Express `trust proxy` must be configured at deployment time so
 * `req.ip` reflects the trusted client address; until then, the resolved value
 * may be the immediate peer (for example the proxy itself). Phone-level OTP
 * limits remain enforced regardless.
 *
 * When no trustworthy IP can be derived, `clientIp` is omitted rather than
 * inventing one from untrusted headers.
 */
export function resolveOtpRequestSource(request: Request): OtpRequestSource {
  const candidates = [request.ip, request.socket.remoteAddress];
  for (const candidate of candidates) {
    const normalized = normalizeIpCandidate(candidate);
    if (normalized !== undefined) {
      return { clientIp: normalized };
    }
  }
  return {};
}

function normalizeIpCandidate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let candidate = value.trim().toLowerCase();
  if (candidate === '') {
    return undefined;
  }

  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice('::ffff:'.length);
  }

  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1);
  }

  const zoneIndex = candidate.indexOf('%');
  if (zoneIndex >= 0) {
    candidate = candidate.slice(0, zoneIndex);
  }

  if (IPV4_PATTERN.test(candidate)) {
    return candidate;
  }
  if (candidate.includes(':') && IPV6_PATTERN.test(candidate)) {
    return candidate;
  }
  return undefined;
}
