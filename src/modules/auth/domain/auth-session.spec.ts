import { randomUUID } from 'node:crypto';
import {
  digestRefreshToken,
  generateRefreshToken,
} from './refresh-token-digest';
import type { AuthSessionRecord } from './auth-session';

describe('auth session domain helpers', () => {
  it('produces digests suitable for AuthSession.refreshTokenHash storage', () => {
    const digest = digestRefreshToken(generateRefreshToken());

    expect(digest).toHaveLength(43);
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('uses collision-resistant UUIDs for tokenFamilyId examples', () => {
    const familyId = randomUUID();
    expect(familyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it('keeps AuthSessionRecord free of Prisma naming in shape checks', () => {
    const sample: AuthSessionRecord = {
      id: randomUUID(),
      userId: randomUUID(),
      refreshTokenHash: digestRefreshToken(generateRefreshToken()),
      tokenFamilyId: randomUUID(),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    expect(sample.revokedAt).toBeNull();
    expect(Object.keys(sample)).not.toContain('user');
  });
});
