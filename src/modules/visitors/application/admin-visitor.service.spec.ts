import { AdminVisitorService } from './admin-visitor.service';
import { VisitorNotFoundError } from '../domain/visitor-errors';

describe('AdminVisitorService', () => {
  it('uses bounded default visitor pagination and stable default sort', async () => {
    const listAdmin = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const service = new AdminVisitorService({ listAdmin } as never);
    await expect(
      service.list({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    expect(listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    );
  });

  it('fails closed for an unknown visitor and does not list referrals', async () => {
    const findAdminById = jest.fn().mockResolvedValue(null);
    const listAdminReferrals = jest.fn();
    const service = new AdminVisitorService({
      findAdminById,
      listAdminReferrals,
    } as never);
    await expect(
      service.listReferrals('11111111-1111-4111-8111-111111111111', {
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(VisitorNotFoundError);
    expect(listAdminReferrals).not.toHaveBeenCalled();
  });
});
