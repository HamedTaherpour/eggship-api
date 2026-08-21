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
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateCatalogTables(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Category", "Region" RESTART IDENTITY CASCADE',
  );
}

describe('Category and Region persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let categories: CategoryRepository;
  let regions: RegionRepository;
  let categoryService: CategoryService;
  let regionService: RegionService;

  beforeAll(async () => {
    // Persistence-focused module graph: avoid AuthModule/Redis (not needed for
    // Category/Region repository and service integration).
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
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
});
