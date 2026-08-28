import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CsrfGuard } from './csrf.guard';
import type { CsrfService } from './csrf.service';

function context(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('CsrfGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe method %s', (method) => {
    expect(
      new CsrfGuard({
        validate: jest.fn(),
      } as unknown as CsrfService).canActivate(
        context({ method, path: '/api/v1/orders' }),
      ),
    ).toBe(true);
  });

  it('allows Bearer-only unsafe transport without invoking CSRF validation', () => {
    const validate = jest.fn();
    const csrf = { validate } as unknown as CsrfService;
    expect(
      new CsrfGuard(csrf).canActivate(
        context({
          method: 'POST',
          path: '/api/v1/orders',
          headers: { authorization: 'Bearer native-token' },
        }),
      ),
    ).toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });
});
