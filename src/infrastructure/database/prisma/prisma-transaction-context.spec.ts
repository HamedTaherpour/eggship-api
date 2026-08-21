import { PrismaTransactionContext } from './prisma-transaction-context';

describe('PrismaTransactionContext', () => {
  it('does not expose a Prisma client field on the instance', () => {
    const tx = new PrismaTransactionContext(
      {} as ConstructorParameters<typeof PrismaTransactionContext>[0],
    );
    expect(tx).not.toHaveProperty('client');
  });
});
