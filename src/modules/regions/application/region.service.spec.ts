import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { resolvePageRequest } from '../../../common/list';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { RegionRecord } from '../domain/region';
import { RegionNotFoundError } from '../domain/region-errors';
import type { RegionRepository } from '../infrastructure/region.repository';
import { AdminRegionListQueryDto } from '../api/dto/admin-region-list-query.dto';
import { resolveRegionSort } from '../api/dto/admin-region-list-query.dto';
import {
  toAdminRegionDto,
  toPublicRegionDto,
} from '../api/dto/region-response.dto';
import { CreateRegionBodyDto } from '../api/dto/create-region.dto';
import { UpdateRegionBodyDto } from '../api/dto/update-region.dto';
import { RegionService } from './region.service';
import type { TransactionRunner } from '../../../infrastructure/database/transaction';
import type { AuditLogService } from '../../audit/application/audit-log.service';

function record(overrides: Partial<RegionRecord> = {}): RegionRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Tehran',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RegionService', () => {
  let repository: jest.Mocked<
    Pick<
      RegionRepository,
      'listActiveOrderedByName' | 'list' | 'create' | 'update' | 'findById'
    >
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: RegionService;
  const transactions = {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as TransactionRunner;
  const audit = { append: jest.fn() } as unknown as AuditLogService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      listActiveOrderedByName: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    logger = { info: jest.fn() };
    service = new RegionService(
      repository as unknown as RegionRepository,
      logger as unknown as ApplicationLogger,
      transactions,
      audit,
    );
  });

  it('lists public active regions from the repository', async () => {
    const items = [record()];
    repository.listActiveOrderedByName.mockResolvedValue(items);
    await expect(service.listPublicActive()).resolves.toEqual(items);
  });

  it('maps admin list query fields explicitly', async () => {
    repository.list.mockResolvedValue({ items: [record()], total: 1 });
    const query = plainToInstance(AdminRegionListQueryDto, {
      page: '1',
      pageSize: '5',
      search: 'teh',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      isActive: 'false',
    });
    expect(await validate(query)).toHaveLength(0);

    await service.listAdmin(query);
    expect(repository.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 5,
      search: 'teh',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      isActive: false,
    });
  });

  it('defaults sort to name asc', () => {
    expect(resolvePageRequest({})).toEqual({ page: 1, pageSize: 20 });
    expect(resolveRegionSort({})).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  it('creates and updates with structured events and not-found mapping', async () => {
    const created = record();
    repository.create.mockResolvedValue(created);
    const createBody = plainToInstance(CreateRegionBodyDto, { name: 'Tehran' });
    expect(await validate(createBody)).toHaveLength(0);
    await service.create(createBody);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'region.created',
        regionId: created.id,
      }),
      'Region created',
    );

    const updated = record({ isActive: false });
    repository.update.mockResolvedValue(updated);
    repository.findById.mockResolvedValue(record());
    const updateBody = plainToInstance(UpdateRegionBodyDto, {
      isActive: false,
    });
    expect(await validate(updateBody)).toHaveLength(0);
    await expect(service.update(updated.id, updateBody)).resolves.toEqual(
      updated,
    );

    repository.update.mockResolvedValue(null);
    await expect(service.update(updated.id, {})).rejects.toBeInstanceOf(
      RegionNotFoundError,
    );
  });

  it('maps public and admin DTOs', () => {
    const item = record({ isActive: false });
    expect(toPublicRegionDto(item)).toEqual({ id: item.id, name: item.name });
    expect(toAdminRegionDto(item).isActive).toBe(false);
  });
});

describe('AdminRegionListQueryDto validation', () => {
  it('rejects unknown sortBy', async () => {
    const bad = plainToInstance(AdminRegionListQueryDto, { sortBy: 'code' });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });
});
