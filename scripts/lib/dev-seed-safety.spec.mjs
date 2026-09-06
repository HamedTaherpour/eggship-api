import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseApprovedDevelopmentDatabase } from './dev-seed-safety.mjs';

describe('development seed database safety', () => {
  it('accepts only development loopback eggship', () => {
    assert.equal(
      parseApprovedDevelopmentDatabase({
        nodeEnv: 'development',
        databaseUrl: 'postgresql://user:secret@127.0.0.1:5432/eggship',
      }).displayTarget,
      'postgresql://127.0.0.1:5432/eggship',
    );
  });
  it('rejects non-development and non-eggship targets', () => {
    for (const nodeEnv of ['production', 'staging', 'test', undefined]) {
      assert.throws(() =>
        parseApprovedDevelopmentDatabase({
          nodeEnv,
          databaseUrl: 'postgresql://127.0.0.1:5432/eggship',
        }),
      );
    }
    assert.throws(() =>
      parseApprovedDevelopmentDatabase({
        nodeEnv: 'development',
        databaseUrl: 'postgresql://127.0.0.1:5432/eggship_test',
      }),
    );
  });
  it('rejects remote hosts without exposing credentials', () => {
    assert.throws(
      () =>
        parseApprovedDevelopmentDatabase({
          nodeEnv: 'development',
          databaseUrl: 'postgresql://user:secret@db.example.invalid/eggship',
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes('loopback') &&
        !error.message.includes('secret'),
    );
  });
});
