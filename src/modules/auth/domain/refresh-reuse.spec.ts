import {
  classifyRefreshDigestMismatch,
  remainingSessionSeconds,
} from './refresh-reuse';

describe('classifyRefreshDigestMismatch', () => {
  const familyId = '11111111-1111-4111-8111-111111111111';
  const nowMs = Date.parse('2026-08-21T00:00:10.000Z');

  it('treats a recently consumed same-family digest as a lost race', () => {
    expect(
      classifyRefreshDigestMismatch({
        sessionFamilyId: familyId,
        consumed: {
          tokenFamilyId: familyId,
          consumedAt: new Date('2026-08-21T00:00:09.000Z'),
        },
        nowMs,
      }),
    ).toEqual({ kind: 'lost_race' });
  });

  it('treats an old same-family consumed digest as confirmed reuse', () => {
    expect(
      classifyRefreshDigestMismatch({
        sessionFamilyId: familyId,
        consumed: {
          tokenFamilyId: familyId,
          consumedAt: new Date('2026-08-21T00:00:00.000Z'),
        },
        nowMs: Date.parse('2026-08-21T00:00:20.000Z'),
      }),
    ).toEqual({ kind: 'confirmed_reuse', tokenFamilyId: familyId });
  });

  it('treats a missing or other-family consumption as a plain mismatch', () => {
    expect(
      classifyRefreshDigestMismatch({
        sessionFamilyId: familyId,
        consumed: null,
        nowMs,
      }),
    ).toEqual({ kind: 'digest_mismatch' });
  });
});

describe('remainingSessionSeconds', () => {
  it('returns zero when the session has already expired', () => {
    const now = new Date('2026-08-21T00:00:10.000Z');
    expect(
      remainingSessionSeconds(new Date('2026-08-21T00:00:00.000Z'), now),
    ).toBe(0);
  });
});
