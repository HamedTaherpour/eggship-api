import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { InMemoryStorageProvider } from '../../../src/infrastructure/storage/in-memory-storage.provider';
import { STORAGE_PROVIDER } from '../../../src/infrastructure/storage/storage.tokens';
import { MediaService } from '../../../src/modules/media/application/media.service';
import { MEDIA_UPLOAD_LIMITS } from '../../../src/modules/media/application/media.service';
import {
  jpegFixture,
  pngFixture,
} from '../../../src/modules/media/domain/media-test-fixtures';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateMediaTable(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Media" RESTART IDENTITY CASCADE',
  );
}

describe('Media library persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let media: MediaRepository;
  let service: MediaService;
  let storage: InMemoryStorageProvider;

  beforeAll(async () => {
    storage = new InMemoryStorageProvider('https://media.test.invalid');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
      ],
      providers: [
        MediaRepository,
        MediaService,
        { provide: STORAGE_PROVIDER, useValue: storage },
        {
          provide: MEDIA_UPLOAD_LIMITS,
          useValue: {
            maxFileBytes: 5_242_880,
            maxFilesPerBatch: 10,
            maxBatchBytes: 26_214_400,
            uploadConcurrency: 3,
          },
        },
      ],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    media = moduleRef.get(MediaRepository);
    service = moduleRef.get(MediaService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateMediaTable(prisma);
    storage.clearForTest();
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists unique storageKey metadata without binaries', async () => {
    const created = await media.create({
      storageKey: 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg',
      originalFileName: 'eggs.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    expect(created.originalFileName).toBe('eggs.jpg');
    expect(created).not.toHaveProperty('buffer');

    await expect(
      media.create({
        storageKey: 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg',
        originalFileName: 'dup.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 16,
        width: 1,
        height: 1,
      }),
    ).rejects.toThrow();

    const listed = await media.list({
      page: 1,
      pageSize: 10,
      search: 'eggs',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(created.id);
  });

  it('upload then delete removes the row', async () => {
    const batch = await service.uploadBatch([
      {
        originalName: 'banner.png',
        claimedMimeType: 'image/png',
        size: pngFixture().length,
        buffer: pngFixture(),
      },
      {
        originalName: 'photo.jpg',
        claimedMimeType: 'image/jpeg',
        size: jpegFixture().length,
        buffer: jpegFixture(),
      },
    ]);
    expect(batch.summary.uploaded).toBe(2);
    const first = batch.items[0];
    if (first === undefined || first.status !== 'uploaded') {
      throw new Error('expected uploaded item');
    }
    await service.deleteAdmin(first.media.id);
    expect(await media.findById(first.media.id)).toBeNull();
    expect(await prisma.media.count()).toBe(1);
  });

  it('does not invent a Product media FK', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Product'
    `;
    expect(columns.map((row) => row.column_name)).not.toContain('imageMediaId');
    expect(columns.map((row) => row.column_name)).not.toContain('mediaId');
    expect(randomUUID().length).toBeGreaterThan(0);
  });
});
