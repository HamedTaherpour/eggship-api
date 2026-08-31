import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { CategoryService } from '../../../src/modules/categories/application/category.service';
import { CategoryRepository } from '../../../src/modules/categories/infrastructure/category.repository';
import { RegionService } from '../../../src/modules/regions/application/region.service';
import { RegionRepository } from '../../../src/modules/regions/infrastructure/region.repository';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
import { AuditAction } from '../../../src/modules/audit/domain/audit-event';
import type { AuthenticatedPrincipal } from '../../../src/modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../../src/modules/auth/domain/subject-type';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateCatalogTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "Category", "Region" RESTART IDENTITY CASCADE',
  );
}

describe('Category and Region persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let regions: RegionRepository;
  let categoryService: CategoryService;
  let regionService: RegionService;
  let audit: AuditLogService;
  const adminPrincipal: AuthenticatedPrincipal = {
    subjectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    subjectType: AuthSubjectType.ADMIN,
    sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };

  beforeAll(async () => {
    // Persistence-focused module graph: avoid AuthModule/Redis (not needed for
    // Category/Region repository and service integration).
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        AuditModule,
      ],
      providers: [
        CategoryRepository,
        CategoryService,
        RegionRepository,
        RegionService,
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    categories = moduleRef.get(CategoryRepository);
    regions = moduleRef.get(RegionRepository);
    categoryService = moduleRef.get(CategoryService);
    regionService = moduleRef.get(RegionService);
    audit = moduleRef.get(AuditLogService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateCatalogTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and reads categories and regions', async () => {
    const category = await categories.create({ name: '  Dairy ' });
    expect(category.name).toBe('Dairy');
    expect(await categories.findById(category.id)).toMatchObject({
      id: category.id,
      name: 'Dairy',
      isActive: true,
    });

    const region = await regions.create({ name: 'Tehran' });
    expect(await regions.findById(region.id)).toMatchObject({
      name: 'Tehran',
      isActive: true,
    });
  });

  it('hides inactive rows from public active lists', async () => {
    const active = await categories.create({ name: 'Active' });
    const inactive = await categories.create({
      name: 'Inactive',
      isActive: false,
    });

    const publicList = await categoryService.listPublicActive();
    expect(publicList.map((row) => row.id)).toEqual([active.id]);
    expect(publicList.map((row) => row.id)).not.toContain(inactive.id);

    const regionActive = await regions.create({ name: 'Visible' });
    await regions.create({ name: 'Hidden', isActive: false });
    const publicRegions = await regionService.listPublicActive();
    expect(publicRegions.map((row) => row.id)).toEqual([regionActive.id]);
  });

  it('lists with search, sort, and isActive filter', async () => {
    await categories.create({ name: 'Alpha' });
    await categories.create({ name: 'Beta', isActive: false });
    await categories.create({ name: 'Alpine' });

    const page = await categories.list({
      page: 1,
      pageSize: 10,
      search: 'alp',
      sortBy: 'name',
      sortOrder: 'asc',
      isActive: true,
    });

    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.name)).toEqual(['Alpha', 'Alpine']);
  });

  it('allows duplicate names because uniqueness is not evidenced (MIG-01)', async () => {
    const first = await categories.create({ name: 'Dairy' });
    const second = await categories.create({ name: 'Dairy' });
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe(second.name);
  });

  it('updates and deactivates without hard delete', async () => {
    const created = await regions.create({ name: 'Tehran' });
    const updated = await regions.update(created.id, {
      name: 'Karaj',
      isActive: false,
    });
    expect(updated).toMatchObject({ name: 'Karaj', isActive: false });
    expect(await regions.findById(created.id)).not.toBeNull();
    expect(await regions.update(randomUUID(), { name: 'X' })).toBeNull();
  });

  it('rejects empty names at the database check constraint', async () => {
    await expect(
      prisma.category.create({
        data: { name: '   ' },
      }),
    ).rejects.toThrow();
  });

  it('audits Category and Region mutations atomically with bounded metadata', async () => {
    const category = await categoryService.create(
      { name: 'Dairy' },
      adminPrincipal,
    );
    await categoryService.update(
      category.id,
      { name: 'Eggs', isActive: false },
      adminPrincipal,
    );
    const region = await regionService.create(
      { name: 'Tehran' },
      adminPrincipal,
    );
    await regionService.update(
      region.id,
      { name: 'Karaj', isActive: false },
      adminPrincipal,
    );

    const rows = await prisma.auditLog.findMany({
      where: { entityId: { in: [category.id, region.id] } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.action)).toEqual([
      AuditAction.CATEGORY_CREATED,
      AuditAction.CATEGORY_UPDATED,
      AuditAction.REGION_CREATED,
      AuditAction.REGION_UPDATED,
    ]);
    expect(rows[1]!.metadata).toEqual({ changedFields: ['name', 'isActive'] });
    expect(rows[3]!.metadata).toEqual({ changedFields: ['name', 'isActive'] });
    expect(
      rows.every(
        (row) =>
          row.actorType === 'ADMIN' && row.actorId === adminPrincipal.subjectId,
      ),
    ).toBe(true);
  });

  it('rolls back Category and Region when audit append fails', async () => {
    jest.spyOn(audit, 'append').mockRejectedValue(new Error('audit failure'));
    await expect(
      categoryService.create({ name: 'Rollback category' }, adminPrincipal),
    ).rejects.toThrow('audit failure');
    await expect(
      regionService.create({ name: 'Rollback region' }, adminPrincipal),
    ).rejects.toThrow('audit failure');
    expect(
      await prisma.category.findMany({ where: { name: 'Rollback category' } }),
    ).toHaveLength(0);
    expect(
      await prisma.region.findMany({ where: { name: 'Rollback region' } }),
    ).toHaveLength(0);
    jest.restoreAllMocks();
  });
});
