import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { InMemoryStorageProvider } from '../../../src/infrastructure/storage/in-memory-storage.provider';
import { StorageProviderError } from '../../../src/infrastructure/storage/storage-provider';
import { STORAGE_PROVIDER } from '../../../src/infrastructure/storage/storage.tokens';
import { MediaService } from '../../../src/modules/media/application/media.service';
import { MEDIA_UPLOAD_LIMITS } from '../../../src/modules/media/application/media.service';
import { MediaErrorCode } from '../../../src/modules/media/domain/media-errors';
import {
  jpegFixture,
  pngFixture,
} from '../../../src/modules/media/domain/media-test-fixtures';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { AuditModule } from '../../../src/modules/audit/audit.module';
import { AuditLogService } from '../../../src/modules/audit/application/audit-log.service';
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
  let audit: AuditLogService;

  beforeAll(async () => {
    storage = new InMemoryStorageProvider('https://media.test.invalid');
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
        AuditModule,
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
    audit = moduleRef.get(AuditLogService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateMediaTable(prisma);
    await prisma.auditLog.deleteMany({ where: { action: 'media.deleted' } });
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
    expect(first.media.accessClass).toBe('PUBLIC');
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    await service.deleteAdmin(first.media.id, admin.id);
    expect(await media.findById(first.media.id)).toBeNull();
    expect(await prisma.media.count()).toBe(1);
  });

  it('persists PUBLIC and ADMIN_ONLY accessClass and serves signed reads accordingly', async () => {
    const publicBatch = await service.uploadBatch(
      [
        {
          originalName: 'storefront.jpg',
          claimedMimeType: 'image/jpeg',
          size: jpegFixture().length,
          buffer: jpegFixture(),
        },
      ],
      'PUBLIC',
    );
    const privateBatch = await service.uploadBatch(
      [
        {
          originalName: 'receipt.jpg',
          claimedMimeType: 'image/jpeg',
          size: jpegFixture().length,
          buffer: jpegFixture(),
        },
      ],
      'ADMIN_ONLY',
    );
    const publicItem = publicBatch.items[0];
    const privateItem = privateBatch.items[0];
    if (
      publicItem === undefined ||
      publicItem.status !== 'uploaded' ||
      privateItem === undefined ||
      privateItem.status !== 'uploaded'
    ) {
      throw new Error('expected uploaded media');
    }

    const loadedPublic = await media.findById(publicItem.media.id);
    const loadedPrivate = await media.findById(privateItem.media.id);
    expect(loadedPublic?.accessClass).toBe('PUBLIC');
    expect(loadedPrivate?.accessClass).toBe('ADMIN_ONLY');

    const publicSigned = await service.createPublicRedirect(
      publicItem.media.id,
    );
    expect(publicSigned.url).toContain('signed-test=1');
    await expect(
      service.createPublicRedirect(privateItem.media.id),
    ).rejects.toMatchObject({ code: MediaErrorCode.NOT_FOUND });
    await expect(
      service.createSettlementReceiptRead(publicItem.media.id),
    ).rejects.toMatchObject({ code: MediaErrorCode.NOT_FOUND });
    const adminSigned = await service.createSettlementReceiptRead(
      privateItem.media.id,
    );
    expect(adminSigned.url).toContain('signed-test=1');
    expect(JSON.stringify(adminSigned)).not.toContain('storageKey');
  });

  it('persists exactly one privacy-safe media.deleted event with the deletion', async () => {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const created = await media.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: 'private-name.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    await storage.put({
      storageKey: created.storageKey,
      body: Buffer.from('object'),
      mimeType: created.mimeType,
    });

    await service.deleteAdmin(created.id, admin.id);

    const events = await prisma.auditLog.findMany({
      where: { action: 'media.deleted', entityId: created.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'media.deleted',
      entityType: 'MEDIA',
      entityId: created.id,
      metadata: null,
    });
    expect(JSON.stringify(events[0])).not.toContain(created.storageKey);
    expect(JSON.stringify(events[0])).not.toContain(created.originalFileName);
  });

  it('rolls back the Media row when AuditLog append fails', async () => {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const created = await media.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: 'audit-failure.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    await storage.put({
      storageKey: created.storageKey,
      body: Buffer.from('object'),
      mimeType: created.mimeType,
    });
    const append = jest
      .spyOn(audit, 'append')
      .mockRejectedValueOnce(new Error('forced audit failure'));

    await expect(
      service.deleteAdmin(created.id, admin.id),
    ).rejects.toMatchObject({
      name: 'MediaDeleteFailedError',
      code: MediaErrorCode.DELETE_FAILED,
    });
    append.mockRestore();
    expect(await media.findById(created.id)).not.toBeNull();
    expect(await storage.exists(created.storageKey)).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { action: 'media.deleted', entityId: created.id },
      }),
    ).toBe(0);
  });

  it('succeeds when the storage object is already absent and persists one media.deleted audit', async () => {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const created = await media.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: 'orphan-row.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    expect(await storage.exists(created.storageKey)).toBe(false);

    await service.deleteAdmin(created.id, admin.id);

    expect(await media.findById(created.id)).toBeNull();
    const events = await prisma.auditLog.findMany({
      where: { action: 'media.deleted', entityId: created.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'media.deleted',
      entityType: 'MEDIA',
      entityId: created.id,
      metadata: null,
    });
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(created.storageKey);
    expect(serialized).not.toContain(created.originalFileName);
    expect(serialized).not.toContain(created.mimeType);
    expect(serialized).not.toContain(storage.getPublicUrl(created.storageKey));
  });

  it('keeps the Media row and emits no audit when storage delete fails', async () => {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const created = await media.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: 'storage-failure.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    await storage.put({
      storageKey: created.storageKey,
      body: Buffer.from('object'),
      mimeType: created.mimeType,
    });
    const deleteSpy = jest
      .spyOn(storage, 'delete')
      .mockRejectedValueOnce(
        new StorageProviderError('Object storage delete failed.'),
      );

    await expect(
      service.deleteAdmin(created.id, admin.id),
    ).rejects.toMatchObject({
      name: 'MediaDeleteFailedError',
      code: MediaErrorCode.DELETE_FAILED,
    });
    deleteSpy.mockRestore();

    expect(await media.findById(created.id)).not.toBeNull();
    expect(await storage.exists(created.storageKey)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: 'media.deleted', entityId: created.id },
      }),
    ).toBe(0);
    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: created.id },
    });
    for (const row of auditRows) {
      expect(JSON.stringify(row)).not.toContain(created.storageKey);
      expect(JSON.stringify(row)).not.toContain('Object storage delete failed');
    }
  });

  it('does not append a second media.deleted audit when delete is replayed', async () => {
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const created = await media.create({
      storageKey: `media/2026/08/${randomUUID()}.png`,
      originalFileName: 'replay.png',
      mimeType: 'image/png',
      sizeBytes: 16,
      width: 1,
      height: 1,
    });
    await storage.put({
      storageKey: created.storageKey,
      body: Buffer.from('object'),
      mimeType: created.mimeType,
    });

    await service.deleteAdmin(created.id, admin.id);
    expect(
      await prisma.auditLog.count({
        where: { action: 'media.deleted', entityId: created.id },
      }),
    ).toBe(1);

    await expect(
      service.deleteAdmin(created.id, admin.id),
    ).rejects.toMatchObject({
      name: 'MediaNotFoundError',
      code: MediaErrorCode.NOT_FOUND,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'media.deleted', entityId: created.id },
      }),
    ).toBe(1);
  });

  it('exposes the MED-01 Product media FK without changing CAT-04 Media ownership', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Product'
    `;
    expect(columns.map((row) => row.column_name)).toContain('imageMediaId');
    expect(columns.map((row) => row.column_name)).not.toContain('mediaId');
    expect(randomUUID().length).toBeGreaterThan(0);
  });
});
