import { AdminRole } from '../common/authz/admin-role';
import { InvalidAdminEmailError } from '../modules/admins/domain/admin-email';
import { WeakAdminPasswordError } from '../modules/admins/domain/admin-password-policy';
import { parseAdminCreateInput } from './admin-create-input';

describe('parseAdminCreateInput', () => {
  const password = 'correct horse battery staple';

  it('canonicalizes email and requires an explicit known role', () => {
    const parsed = parseAdminCreateInput({
      email: '  Ops@Example.TEST ',
      password,
      role: AdminRole.WAREHOUSE,
    });

    expect(parsed.email).toBe('ops@example.test');
    expect(parsed.role).toBe(AdminRole.WAREHOUSE);
    expect(parsed.password).toBe(password);
  });

  it('refuses an omitted role instead of defaulting', () => {
    expect(() =>
      parseAdminCreateInput({
        email: 'ops@example.test',
        password,
        role: undefined,
      }),
    ).toThrow(/no default/u);
  });

  it('refuses an unknown role', () => {
    expect(() =>
      parseAdminCreateInput({
        email: 'ops@example.test',
        password,
        role: 'not-a-role',
      }),
    ).toThrow(/Unknown admin role/u);
  });

  it('rejects a weak password before returning', () => {
    expect(() =>
      parseAdminCreateInput({
        email: 'ops@example.test',
        password: 'short',
        role: AdminRole.ORDER_OPS,
      }),
    ).toThrow(WeakAdminPasswordError);
  });

  it('rejects a non-canonicalizable email', () => {
    expect(() =>
      parseAdminCreateInput({
        email: 'ops@localhost',
        password,
        role: AdminRole.WAREHOUSE,
      }),
    ).toThrow(InvalidAdminEmailError);
  });
});
