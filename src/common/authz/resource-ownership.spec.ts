import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import { AuthSubjectType } from '../../modules/auth/domain/subject-type';
import { requireCustomerOwnerId } from './resource-ownership';

function capture(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe('requireCustomerOwnerId', () => {
  it('derives the owner id from the authenticated USER principal', () => {
    expect(
      requireCustomerOwnerId({
        subjectId: 'user-1',
        subjectType: AuthSubjectType.USER,
        sessionId: 'session-1',
      }),
    ).toBe('user-1');
  });

  it('rejects a missing principal as unauthenticated', () => {
    const thrown = capture(() => requireCustomerOwnerId(undefined));

    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({ code: AuthErrorCode.UNAUTHENTICATED });
  });

  it('forbids an ADMIN principal so admin access cannot impersonate an owner', () => {
    // Approved contract: authenticated but wrong subject type is 403, not 401,
    // so a browser client cannot refresh-and-retry into a loop.
    const thrown = capture(() =>
      requireCustomerOwnerId({
        subjectId: 'admin-1',
        subjectType: AuthSubjectType.ADMIN,
        sessionId: 'session-1',
      }),
    );

    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({ code: AuthErrorCode.FORBIDDEN });
  });

  it('keeps the wrong-subject denial free of policy detail', () => {
    const thrown = capture(() =>
      requireCustomerOwnerId({
        subjectId: 'admin-1',
        subjectType: AuthSubjectType.ADMIN,
        sessionId: 'session-1',
      }),
    );

    expect((thrown as AuthError).message).toBe('Insufficient permissions.');
    expect((thrown as AuthError).message).not.toMatch(/ADMIN|admin-1/u);
  });
});
