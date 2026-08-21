import { REFRESH_REUSE_RACE_GRACE_MS } from './auth-session';

export type RefreshReuseClassification =
  | { kind: 'lost_race' }
  | { kind: 'confirmed_reuse'; tokenFamilyId: string }
  | { kind: 'digest_mismatch' };

export interface RefreshReuseConsumptionHint {
  tokenFamilyId: string;
  consumedAt: Date;
}

/**
 * Classifies a presented refresh digest that does not match the session's
 * current hash. Shared by User and Admin session lifecycle so race-grace and
 * confirmed-reuse semantics cannot drift, without collapsing the two
 * persistence models into one type.
 */
export function classifyRefreshDigestMismatch(input: {
  sessionFamilyId: string;
  consumed: RefreshReuseConsumptionHint | null;
  nowMs: number;
  raceGraceMs?: number;
}): RefreshReuseClassification {
  const graceMs = input.raceGraceMs ?? REFRESH_REUSE_RACE_GRACE_MS;
  if (
    input.consumed === null ||
    input.consumed.tokenFamilyId !== input.sessionFamilyId
  ) {
    return { kind: 'digest_mismatch' };
  }

  const ageMs = input.nowMs - input.consumed.consumedAt.getTime();
  if (ageMs <= graceMs) {
    return { kind: 'lost_race' };
  }

  return {
    kind: 'confirmed_reuse',
    tokenFamilyId: input.consumed.tokenFamilyId,
  };
}

export function remainingSessionSeconds(expiresAt: Date, now: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return seconds > 0 ? seconds : 0;
}
