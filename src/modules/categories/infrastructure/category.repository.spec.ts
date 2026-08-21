import { CategoryRepository } from './category.repository';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

describe('CategoryRepository mapping', () => {
  it('lists active categories with isActive true and name ascending', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      category: { findMany },
    } as unknown as PrismaService;
    const repository = new CategoryRepository(prisma);

    await repository.listActiveOrderedByName();

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('maps allowlisted sort fields and search/isActive filters explicitly', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn(async (ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
      category: { count, findMany },
    } as unknown as PrismaService;
    const repository = new CategoryRepository(prisma);

    await repository.list({
      page: 1,
      pageSize: 20,
      search: 'dairy',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      isActive: false,
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        isActive: false,
        name: { contains: 'dairy', mode: 'insensitive' },
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: false,
        name: { contains: 'dairy', mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });
});
