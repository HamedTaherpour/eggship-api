import { AdminCustomerService } from './admin-customer.service';
import { buildAdminCustomerWhere } from '../infrastructure/admin-customer.repository';
import { CustomerNotFoundError } from '../domain/customer-errors';
import type { AdminCustomerRecord } from '../domain/customer-admin';
import type { AdminCustomerListQueryDto } from '../api/dto/admin-customer-list-query.dto';

function record(
  partial: Partial<AdminCustomerRecord> = {},
): AdminCustomerRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    phone: '+989121234567',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    referral: null,
    ...partial,
  };
}

describe('AdminCustomerService', () => {
  it('lists through the repository with pagination defaults and maps totals', async () => {
    const items = [record()];
    const list = jest.fn().mockResolvedValue({ items, total: 1 });
    const service = new AdminCustomerService({ list } as never);
    const query = {
      page: 1,
      pageSize: 20,
    } as AdminCustomerListQueryDto;

    const page = await service.listAdmin(query);

    expect(list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      isActive: undefined,
      hasReferral: undefined,
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta.total).toBe(1);
  });

  it('throws CUSTOMER_NOT_FOUND when the admin detail id is unknown', async () => {
    const service = new AdminCustomerService({
      list: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
    } as never);

    await expect(
      service.getAdminById('22222222-2222-4222-8222-222222222222'),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('returns the detail record when present', async () => {
    const expected = record();
    const service = new AdminCustomerService({
      list: jest.fn(),
      findById: jest.fn().mockResolvedValue(expected),
    } as never);

    await expect(service.getAdminById(expected.id)).resolves.toBe(expected);
  });
});

describe('buildAdminCustomerWhere', () => {
  it('builds an empty where when no filters are present', () => {
    expect(buildAdminCustomerWhere({})).toEqual({});
  });

  it('maps search/isActive/hasReferral to explicit Prisma filters', () => {
    expect(
      buildAdminCustomerWhere({
        search: '+98912',
        isActive: true,
        hasReferral: true,
      }),
    ).toEqual({
      phone: { contains: '+98912', mode: 'insensitive' },
      isActive: true,
      referralAttribution: { isNot: null },
    });
    expect(buildAdminCustomerWhere({ hasReferral: false })).toEqual({
      referralAttribution: { is: null },
    });
  });
});
