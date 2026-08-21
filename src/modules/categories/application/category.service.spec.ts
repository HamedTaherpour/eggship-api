import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { resolvePageRequest } from '../../../common/list';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { CategoryRecord } from '../domain/category';
import { CategoryNotFoundError } from '../domain/category-errors';
import type { CategoryRepository } from '../infrastructure/category.repository';
import { AdminCategoryListQueryDto } from '../api/dto/admin-category-list-query.dto';
import { resolveCategorySort } from '../api/dto/admin-category-list-query.dto';
import {
  toAdminCategoryDto,
  toPublicCategoryDto,
} from '../api/dto/category-response.dto';
import { CreateCategoryBodyDto } from '../api/dto/create-category.dto';
import { UpdateCategoryBodyDto } from '../api/dto/update-category.dto';
import { CategoryService } from './category.service';

function record(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dairy',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CategoryService', () => {
  let repository: jest.Mocked<
    Pick<
      CategoryRepository,
      'listActiveOrderedByName' | 'list' | 'create' | 'update'
    >
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: CategoryService;

  beforeEach(() => {
    repository = {
      listActiveOrderedByName: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    logger = { info: jest.fn() };
    service = new CategoryService(
      repository as unknown as CategoryRepository,
      logger as unknown as ApplicationLogger,
    );
  });

  it('lists only what the repository returns for the public active list', async () => {
    const items = [
      record(),
      record({ id: '22222222-2222-4222-8222-222222222222', name: 'Eggs' }),
    ];
    repository.listActiveOrderedByName.mockResolvedValue(items);

    await expect(service.listPublicActive()).resolves.toEqual(items);
  });

  it('maps admin list query to pagination, search, sort, and isActive filter', async () => {
    const item = record();
    repository.list.mockResolvedValue({ items: [item], total: 1 });

    const query = plainToInstance(AdminCategoryListQueryDto, {
      page: '2',
      pageSize: '10',
      search: '  dairy ',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      isActive: 'true',
    });
    const violations = await validate(query);
    expect(violations).toHaveLength(0);

    const result = await service.listAdmin(query);
    expect(repository.list).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      search: 'dairy',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      isActive: true,
    });
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.data).toEqual([item]);
  });

  it('uses default sort name asc when sort fields are omitted', () => {
    const page = resolvePageRequest({});
    expect(page).toEqual({ page: 1, pageSize: 20 });
    expect(resolveCategorySort({})).toEqual({
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });

  it('creates a category and emits a structured event', async () => {
    const created = record();
    repository.create.mockResolvedValue(created);

    const body = plainToInstance(CreateCategoryBodyDto, {
      name: '  Dairy ',
      isActive: true,
    });
    expect(await validate(body)).toHaveLength(0);

    await expect(service.create(body)).resolves.toEqual(created);
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Dairy',
      isActive: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'categories',
        operation: 'catalog.category.created',
        categoryId: created.id,
      }),
      'Category created',
    );
  });

  it('updates allowlisted fields only and maps not-found', async () => {
    const updated = record({ name: 'Eggs', isActive: false });
    repository.update.mockResolvedValue(updated);

    const body = plainToInstance(UpdateCategoryBodyDto, {
      name: 'Eggs',
      isActive: false,
    });
    expect(await validate(body)).toHaveLength(0);

    await expect(service.update(updated.id, body)).resolves.toEqual(updated);
    expect(repository.update).toHaveBeenCalledWith(updated.id, {
      name: 'Eggs',
      isActive: false,
    });

    repository.update.mockResolvedValue(null);
    await expect(
      service.update(updated.id, { name: 'X' }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('maps DTOs without leaking Prisma shape extras', () => {
    const item = record({ isActive: false });
    expect(toPublicCategoryDto(item)).toEqual({
      id: item.id,
      name: item.name,
    });
    expect(toAdminCategoryDto(item)).toEqual({
      id: item.id,
      name: item.name,
      isActive: false,
      createdAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z',
    });
  });
});

describe('AdminCategoryListQueryDto validation', () => {
  it('rejects unknown sortBy and non-canonical isActive', async () => {
    const badSort = plainToInstance(AdminCategoryListQueryDto, {
      sortBy: 'slug',
    });
    expect((await validate(badSort)).length).toBeGreaterThan(0);

    const badActive = plainToInstance(AdminCategoryListQueryDto, {
      isActive: '1',
    });
    expect((await validate(badActive)).length).toBeGreaterThan(0);
  });
});
