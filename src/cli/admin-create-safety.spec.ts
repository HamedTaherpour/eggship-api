import {
  assertAdminCreateConfirmation,
  formatMaskedDatabaseTarget,
  maskDatabaseUrl,
} from './admin-create-safety';

describe('admin create safety', () => {
  it('masks credentials from DATABASE_URL', () => {
    const masked = maskDatabaseUrl(
      'postgresql://eggship:s3cret@db.example.invalid:5432/eggship_dev',
    );
    const formatted = formatMaskedDatabaseTarget(masked);

    expect(formatted).toBe('postgresql://db.example.invalid:5432/eggship_dev');
    expect(formatted).not.toContain('s3cret');
    expect(formatted).not.toContain('eggship:');
  });

  it('requires yes in development', () => {
    expect(() =>
      assertAdminCreateConfirmation({
        nodeEnv: 'development',
        confirm: undefined,
        databaseHost: 'db.example.invalid',
      }),
    ).toThrow(/EGGSHIP_ADMIN_CREATE_CONFIRM=yes/u);
  });

  it('requires an explicit production token that includes the database host', () => {
    expect(() =>
      assertAdminCreateConfirmation({
        nodeEnv: 'production',
        confirm: 'yes',
        databaseHost: 'prod-db.example.invalid',
      }),
    ).toThrow(/I_UNDERSTAND_PRODUCTION:prod-db.example.invalid/u);

    expect(() =>
      assertAdminCreateConfirmation({
        nodeEnv: 'production',
        confirm: 'I_UNDERSTAND_PRODUCTION:prod-db.example.invalid',
        databaseHost: 'prod-db.example.invalid',
      }),
    ).not.toThrow();
  });
});
