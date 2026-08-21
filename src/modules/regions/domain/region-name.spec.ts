import { REGION_NAME_MAX_LENGTH, normalizeRegionName } from './region-name';
import { RegionInvalidNameError } from './region-errors';

describe('normalizeRegionName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeRegionName('  Tehran  ')).toBe('Tehran');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => normalizeRegionName('')).toThrow(RegionInvalidNameError);
    expect(() => normalizeRegionName('   ')).toThrow(RegionInvalidNameError);
  });

  it('rejects names longer than the max length', () => {
    expect(() =>
      normalizeRegionName('a'.repeat(REGION_NAME_MAX_LENGTH + 1)),
    ).toThrow(RegionInvalidNameError);
  });

  it('accepts a name at the max length', () => {
    const name = 'a'.repeat(REGION_NAME_MAX_LENGTH);
    expect(normalizeRegionName(name)).toBe(name);
  });
});
