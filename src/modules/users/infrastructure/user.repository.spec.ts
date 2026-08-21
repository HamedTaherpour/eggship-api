import { Prisma } from '../../../generated/prisma/client';
import { isUniqueConstraintError } from './user.repository';

describe('isUniqueConstraintError', () => {
  it('recognizes Prisma unique-constraint failures', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['phone'] },
      },
    );

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isUniqueConstraintError(new Error('boom'))).toBe(false);
    expect(
      isUniqueConstraintError(
        new Prisma.PrismaClientKnownRequestError('foreign key', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      ),
    ).toBe(false);
  });
});
