import { RegionRepository } from './region.repository';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

describe('RegionRepository mapping', () => {
  it('lists active regions with isActive true and name ascending', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      region: { findMany },
    } as unknown as PrismaService;
    const repository = new RegionRepository(prisma);

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
      $transaction: jest
        .fn()
        .mockImplementation(async (ops: unknown[]) =>
          Promise.all(ops as Promise<unknown>[]),
        ),
      region: { count, findMany },
    } as unknown as PrismaService;
    const repository = new RegionRepository(prisma);

    await repository.list({
      page: 2,
      pageSize: 10,
      search: 'teh',
      sortBy: 'updatedAt',
      sortOrder: 'asc',
      isActive: true,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        name: { contains: 'teh', mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'asc' },
      skip: 10,
      take: 10,
    });
  });
});
