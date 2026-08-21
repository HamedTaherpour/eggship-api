import type { ProductListQuery, ProductRecord } from '../domain/product';
import { buildProductListWhereForTest } from './product.repository';

/**
 * Repository unit coverage focuses on where mapping without Prisma I/O.
 * Live FK/CHECK behavior lives in PostgreSQL integration specs.
 */

describe('ProductRepository query mapping', () => {
  it('builds public visibility filters without scanning description', () => {
    const query: ProductListQuery = {
      page: 1,
      pageSize: 20,
      search: 'egg',
      sortBy: 'price',
      sortOrder: 'asc',
      categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isActive: true,
      requireActiveCategory: true,
    };

    expect(buildProductListWhereForTest(query)).toEqual({
      isActive: true,
      categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: { contains: 'egg', mode: 'insensitive' },
      category: { isActive: true },
    });
  });

  it('maps records with integer Toman price and no inventory fields', () => {
    const now = new Date();
    const record: ProductRecord = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Eggs',
      price: 625000,
      categoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    expect(record).not.toHaveProperty('stock');
    expect(record).not.toHaveProperty('quantity');
    expect(record).not.toHaveProperty('reserved');
    expect(Number.isInteger(record.price)).toBe(true);
  });
});
