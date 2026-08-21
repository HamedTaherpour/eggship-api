import {
  InvalidAdminEmailError,
  isCanonicalAdminEmail,
  MAX_ADMIN_EMAIL_LENGTH,
  normalizeAdminEmail,
} from './admin-email';

describe('normalizeAdminEmail', () => {
  it('trims surrounding whitespace and folds case', () => {
    expect(normalizeAdminEmail('  Ops.Lead@EggShip.Test \n')).toBe(
      'ops.lead@eggship.test',
    );
  });

  it('is idempotent, so a stored value normalizes to itself', () => {
    const once = normalizeAdminEmail(' WAREHOUSE@Example.COM ');
    expect(normalizeAdminEmail(once)).toBe(once);
    expect(isCanonicalAdminEmail(once)).toBe(true);
  });

  it('maps capitalization variants of one address to a single canonical key', () => {
    const variants = [
      'ops@example.com',
      'OPS@EXAMPLE.COM',
      'Ops@Example.Com',
      '\tops@example.com  ',
    ];

    expect(new Set(variants.map(normalizeAdminEmail)).size).toBe(1);
  });

  it('does not apply provider-specific folding', () => {
    // Dots and plus tags stay meaningful: these are three distinct admins.
    expect(normalizeAdminEmail('first.last@example.com')).toBe(
      'first.last@example.com',
    );
    expect(normalizeAdminEmail('firstlast@example.com')).toBe(
      'firstlast@example.com',
    );
    expect(normalizeAdminEmail('firstlast+warehouse@example.com')).toBe(
      'firstlast+warehouse@example.com',
    );
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['missing local part', '@example.com'],
    ['missing domain', 'ops@'],
    ['missing at sign', 'ops.example.com'],
    ['two at signs', 'ops@a@example.com'],
    ['undotted domain', 'ops@localhost'],
    ['internal space', 'ops lead@example.com'],
    ['leading dot in local part', '.ops@example.com'],
    ['trailing dot in local part', 'ops.@example.com'],
    ['repeated separator', 'ops..lead@example.com'],
    ['non-ascii local part', 'مدیر@example.com'],
    ['display-name form', 'Ops <ops@example.com>'],
    ['newline injection', 'ops@example.com\nrole: SUPER_ADMIN'],
    ['single-character tld', 'ops@example.c'],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeAdminEmail(input)).toThrow(InvalidAdminEmailError);
    expect(isCanonicalAdminEmail(input)).toBe(false);
  });

  it('rejects an address longer than the storage column allows', () => {
    const domain = '@example.com';
    const tooLong = `${'a'.repeat(MAX_ADMIN_EMAIL_LENGTH - domain.length + 1)}${domain}`;
    const atLimit = `${'a'.repeat(MAX_ADMIN_EMAIL_LENGTH - domain.length)}${domain}`;

    expect(tooLong.length).toBe(MAX_ADMIN_EMAIL_LENGTH + 1);
    expect(() => normalizeAdminEmail(tooLong)).toThrow(InvalidAdminEmailError);
    expect(normalizeAdminEmail(atLimit)).toBe(atLimit);
  });

  it('produces a value the database canonical-email constraint accepts', () => {
    const canonical = normalizeAdminEmail('  Ops+Warehouse@Sub.Example.COM ');

    expect(canonical).toBe(canonical.toLowerCase());
    expect(canonical).toBe(canonical.trim());
    expect(canonical.split('@')).toHaveLength(2);
    expect(canonical).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u);
    expect(canonical.length).toBeGreaterThanOrEqual(6);
    expect(canonical.length).toBeLessThanOrEqual(MAX_ADMIN_EMAIL_LENGTH);
  });
});
