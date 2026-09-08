import { randomUUID } from 'node:crypto';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { InMemoryStorageProvider } from '../../../infrastructure/storage/in-memory-storage.provider';
import type { StorageProvider } from '../../../infrastructure/storage/storage-provider';
import { StorageProviderError } from '../../../infrastructure/storage/storage-provider';
import {
  jpegFixture,
  pngFixture,
  svgFixture,
} from '../domain/media-test-fixtures';
import type { MediaRecord } from '../domain/media';
import { MediaAccessClass } from '../domain/media';
import {
  MediaBatchTooLargeError,
  MediaDeleteFailedError,
  MediaDeliveryFailedError,
  MediaErrorCode,
  MediaNoFilesError,
  MediaNotFoundError,
  MediaReferencedError,
  MediaTooManyFilesError,
  MediaUnsupportedTypeError,
} from '../domain/media-errors';
import type { MediaRepository } from '../infrastructure/media.repository';
import { MediaService } from './media.service';
import type { AuditLogService } from '../../audit/application/audit-log.service';

const LIMITS = {
  maxFileBytes: 1_024,
  maxFilesPerBatch: 4,
  maxBatchBytes: 2_048,
  uploadConcurrency: 2,
};

const READ_TTLS = {
  publicDefault: 3600,
  publicMin: 300,
  publicMax: 86400,
  adminDefault: 300,
  adminMin: 60,
  adminMax: 900,
};

function mediaRow(overrides: Partial<MediaRecord> = {}): MediaRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: randomUUID(),
    storageKey: 'media/2026/08/11111111-1111-4111-8111-111111111111.jpg',
    originalFileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 16,
    width: 1,
    height: 1,
    createdAt: now,
    updatedAt: now,
    accessClass: MediaAccessClass.PUBLIC,
    ...overrides,
  };
}

describe('MediaService', () => {
  let repository: jest.Mocked<
    Pick<
      MediaRepository,
      'list' | 'findById' | 'create' | 'deleteById' | 'isReferencedBySettlement'
    >
  >;
  let storage: InMemoryStorageProvider;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info' | 'warn' | 'error'>>;
  let audit: jest.Mocked<Pick<AuditLogService, 'append'>>;
  let service: MediaService;

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      deleteById: jest.fn(),
      isReferencedBySettlement: jest.fn().mockResolvedValue(false),
    };
    storage = new InMemoryStorageProvider('https://media.test.invalid');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    audit = { append: jest.fn() };
    service = new MediaService(
      repository as unknown as MediaRepository,
      storage,
      LIMITS,
      logger as unknown as ApplicationLogger,
      audit as unknown as AuditLogService,
      READ_TTLS,
    );
  });

  it('uploads mixed batches with independent per-file results', async () => {
    repository.create.mockImplementation((input) =>
      Promise.resolve(mediaRow(input)),
    );

    const result = await service.uploadBatch([
      {
        originalName: 'ok.jpg',
        claimedMimeType: 'image/jpeg',
        size: jpegFixture().length,
        buffer: jpegFixture(),
      },
      {
        originalName: 'bad.svg',
        claimedMimeType: 'image/svg+xml',
        size: svgFixture().length,
        buffer: svgFixture(),
      },
    ]);

    expect(result.summary).toEqual({ total: 2, uploaded: 1, failed: 1 });
    expect(result.items[0]?.status).toBe('uploaded');
    expect(result.items[1]).toMatchObject({
      status: 'failed',
      error: { code: MediaErrorCode.UNSUPPORTED_TYPE },
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'media.batch.completed',
        uploaded: 1,
        failed: 1,
      }),
      expect.any(String),
    );
  });

  it('compensates storage when DB create fails', async () => {
    repository.create.mockRejectedValue(new Error('db down'));
    const jpeg = jpegFixture();

    const result = await service.uploadBatch([
      {
        originalName: 'ok.jpg',
        claimedMimeType: 'image/jpeg',
        size: jpeg.length,
        buffer: jpeg,
      },
    ]);

    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: { code: MediaErrorCode.UPLOAD_FAILED },
    });
    expect(storage.countForTest()).toBe(0);
  });

  it('maps storage put failures to MEDIA_UPLOAD_FAILED without leaking internals', async () => {
    const failing: StorageProvider = {
      put: () =>
        Promise.reject(new StorageProviderError('Object storage put failed.')),
      delete: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      getPublicUrl: (key) => `https://media.test.invalid/${key}`,
      createSignedReadUrl: () =>
        Promise.reject(new StorageProviderError('unused')),
    };
    service = new MediaService(
      repository as unknown as MediaRepository,
      failing,
      LIMITS,
      logger as unknown as ApplicationLogger,
      audit as unknown as AuditLogService,
      READ_TTLS,
    );

    const result = await service.uploadBatch([
      {
        originalName: 'ok.jpg',
        claimedMimeType: 'image/jpeg',
        size: jpegFixture().length,
        buffer: jpegFixture(),
      },
    ]);
    expect(result.items[0]?.status).toBe('failed');
    if (result.items[0]?.status === 'failed') {
      expect(result.items[0].error).toEqual({
        code: MediaErrorCode.UPLOAD_FAILED,
        message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
      });
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'media.upload.failed',
        errorCode: MediaErrorCode.UPLOAD_FAILED,
      }),
      expect.any(String),
      expect.any(Error),
    );
  });

  it('rejects request-level batch bounds before processing files', async () => {
    await expect(service.uploadBatch([])).rejects.toBeInstanceOf(
      MediaNoFilesError,
    );
    await expect(
      service.uploadBatch(
        Array.from({ length: 5 }, () => ({
          originalName: 'a.jpg',
          claimedMimeType: 'image/jpeg',
          size: 10,
          buffer: jpegFixture(),
        })),
      ),
    ).rejects.toBeInstanceOf(MediaTooManyFilesError);

    const png = pngFixture();
    await expect(
      service.uploadBatch([
        {
          originalName: 'a.png',
          claimedMimeType: 'image/png',
          size: 2_000,
          buffer: png,
        },
        {
          originalName: 'b.png',
          claimedMimeType: 'image/png',
          size: 2_000,
          buffer: png,
        },
      ]),
    ).rejects.toBeInstanceOf(MediaBatchTooLargeError);
  });

  it('keeps the row when storage delete fails', async () => {
    const existing = mediaRow();
    repository.findById.mockResolvedValue(existing);
    const failing: StorageProvider = {
      put: () => Promise.resolve({ storageKey: existing.storageKey }),
      delete: () =>
        Promise.reject(
          new StorageProviderError('Object storage delete failed.'),
        ),
      exists: () => Promise.resolve(true),
      getPublicUrl: (key) => `https://media.test.invalid/${key}`,
      createSignedReadUrl: () =>
        Promise.reject(new StorageProviderError('unused')),
    };
    service = new MediaService(
      repository as unknown as MediaRepository,
      failing,
      LIMITS,
      logger as unknown as ApplicationLogger,
      audit as unknown as AuditLogService,
      READ_TTLS,
    );

    await expect(
      service.deleteAdmin(existing.id, randomUUID()),
    ).rejects.toBeInstanceOf(MediaDeleteFailedError);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('deletes storage then the row', async () => {
    const existing = mediaRow();
    repository.findById.mockResolvedValue(existing);
    repository.deleteById.mockResolvedValue(existing);
    await storage.put({
      storageKey: existing.storageKey,
      body: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    await service.deleteAdmin(existing.id, randomUUID());
    expect(await storage.exists(existing.storageKey)).toBe(false);
    expect(repository.deleteById).toHaveBeenCalledWith(existing.id);
  });

  it('rejects a settlement-referenced item before deleting storage', async () => {
    const existing = mediaRow();
    repository.findById.mockResolvedValue(existing);
    repository.isReferencedBySettlement.mockResolvedValue(true);
    await storage.put({
      storageKey: existing.storageKey,
      body: Buffer.from('receipt'),
      mimeType: 'image/jpeg',
    });

    await expect(
      service.deleteAdmin(existing.id, randomUUID()),
    ).rejects.toBeInstanceOf(MediaReferencedError);
    expect(await storage.exists(existing.storageKey)).toBe(true);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('throws MEDIA_NOT_FOUND for missing detail', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.getAdminById(randomUUID())).rejects.toBeInstanceOf(
      MediaNotFoundError,
    );
  });

  it('never exceeds configured upload concurrency while persisting successes', async () => {
    let active = 0;
    let maxActive = 0;
    const tracking: StorageProvider = {
      put: async (input) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        active -= 1;
        return storage.put(input);
      },
      delete: (key) => storage.delete(key),
      exists: (key) => storage.exists(key),
      getPublicUrl: (key) => storage.getPublicUrl(key),
      createSignedReadUrl: (key, options) =>
        storage.createSignedReadUrl(key, options),
    };
    repository.create.mockImplementation((input) =>
      Promise.resolve(mediaRow(input)),
    );
    service = new MediaService(
      repository as unknown as MediaRepository,
      tracking,
      LIMITS,
      logger as unknown as ApplicationLogger,
      audit as unknown as AuditLogService,
      READ_TTLS,
    );

    const files = Array.from({ length: 4 }, (_, index) => ({
      originalName: `n${index}.jpg`,
      claimedMimeType: 'image/jpeg',
      size: jpegFixture().length,
      buffer: jpegFixture(),
    }));
    const result = await service.uploadBatch(files);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.summary.uploaded).toBe(4);
    expect(repository.create).toHaveBeenCalledTimes(4);
  });

  it('keeps eight independent successes when two later-stage puts fail', async () => {
    repository.create.mockImplementation((input) =>
      Promise.resolve(mediaRow(input)),
    );
    const failingPuts: StorageProvider = {
      put: async (input) => {
        if (input.mimeType === 'image/png') {
          throw new StorageProviderError('Object storage put failed.');
        }
        return storage.put(input);
      },
      delete: (key) => storage.delete(key),
      exists: (key) => storage.exists(key),
      getPublicUrl: (key) => storage.getPublicUrl(key),
      createSignedReadUrl: (key, options) =>
        storage.createSignedReadUrl(key, options),
    };
    service = new MediaService(
      repository as unknown as MediaRepository,
      failingPuts,
      { ...LIMITS, maxFilesPerBatch: 10, maxBatchBytes: 16_384 },
      logger as unknown as ApplicationLogger,
      audit as unknown as AuditLogService,
      READ_TTLS,
    );

    const files = [
      ...Array.from({ length: 8 }, (_, index) => ({
        originalName: `ok-${index}.jpg`,
        claimedMimeType: 'image/jpeg',
        size: jpegFixture().length,
        buffer: jpegFixture(),
      })),
      {
        originalName: 'fail-a.png',
        claimedMimeType: 'image/png',
        size: pngFixture().length,
        buffer: pngFixture(),
      },
      {
        originalName: 'fail-b.png',
        claimedMimeType: 'image/png',
        size: pngFixture().length,
        buffer: pngFixture(),
      },
    ];

    const result = await service.uploadBatch(files);
    expect(result.summary).toEqual({ total: 10, uploaded: 8, failed: 2 });
    expect(repository.create).toHaveBeenCalledTimes(8);
    expect(storage.countForTest()).toBe(8);
    expect(
      result.items
        .filter((item) => item.status === 'failed')
        .map((item) => {
          if (item.status !== 'failed') {
            throw new Error('expected failed item');
          }
          return item.error.code;
        }),
    ).toEqual([MediaErrorCode.UPLOAD_FAILED, MediaErrorCode.UPLOAD_FAILED]);
  });

  it('treats a missing row after successful object delete as success', async () => {
    const existing = mediaRow();
    repository.findById.mockResolvedValue(existing);
    repository.deleteById.mockResolvedValue(null);
    await storage.put({
      storageKey: existing.storageKey,
      body: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    await expect(
      service.deleteAdmin(existing.id, randomUUID()),
    ).resolves.toEqual(existing);
    expect(await storage.exists(existing.storageKey)).toBe(false);
  });

  it('maps row-delete throws after object delete to MEDIA_DELETE_FAILED', async () => {
    const existing = mediaRow();
    repository.findById.mockResolvedValue(existing);
    repository.deleteById.mockRejectedValue(new Error('connection reset'));
    await storage.put({
      storageKey: existing.storageKey,
      body: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    await expect(
      service.deleteAdmin(existing.id, randomUUID()),
    ).rejects.toBeInstanceOf(MediaDeleteFailedError);
    expect(await storage.exists(existing.storageKey)).toBe(false);
  });

  it('persists upload accessClass for PUBLIC and ADMIN_ONLY batches', async () => {
    repository.create.mockImplementation((input) =>
      Promise.resolve(mediaRow(input)),
    );
    const publicBatch = await service.uploadBatch(
      [
        {
          originalName: 'public.jpg',
          claimedMimeType: 'image/jpeg',
          size: jpegFixture().length,
          buffer: jpegFixture(),
        },
      ],
      MediaAccessClass.PUBLIC,
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
      MediaAccessClass.ADMIN_ONLY,
    );
    expect(publicBatch.items[0]).toMatchObject({
      status: 'uploaded',
      media: { accessClass: MediaAccessClass.PUBLIC },
    });
    expect(privateBatch.items[0]).toMatchObject({
      status: 'uploaded',
      media: { accessClass: MediaAccessClass.ADMIN_ONLY },
    });
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ accessClass: MediaAccessClass.PUBLIC }),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accessClass: MediaAccessClass.ADMIN_ONLY }),
    );
  });

  it('creates bounded public redirects and rejects ADMIN_ONLY anonymously', async () => {
    const publicMedia = mediaRow({ accessClass: MediaAccessClass.PUBLIC });
    repository.findById.mockResolvedValueOnce(publicMedia);
    await storage.put({
      storageKey: publicMedia.storageKey,
      body: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    const signed = await service.createPublicRedirect(publicMedia.id);
    expect(signed.url).toContain('signed-test=1');
    expect(signed.url).not.toContain('STORAGE_SECRET');
    expect(signed.url).not.toContain('test-secret');
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      READ_TTLS.publicDefault * 1000 + 50,
    );

    repository.findById.mockResolvedValueOnce(
      mediaRow({ accessClass: MediaAccessClass.ADMIN_ONLY }),
    );
    await expect(
      service.createPublicRedirect(randomUUID()),
    ).rejects.toBeInstanceOf(MediaNotFoundError);

    repository.findById.mockResolvedValueOnce(null);
    await expect(
      service.createPublicRedirect(randomUUID()),
    ).rejects.toBeInstanceOf(MediaNotFoundError);
  });

  it('rejects public redirects when the storage object is missing', async () => {
    const publicMedia = mediaRow({ accessClass: MediaAccessClass.PUBLIC });
    repository.findById.mockResolvedValue(publicMedia);
    await expect(
      service.createPublicRedirect(publicMedia.id),
    ).rejects.toBeInstanceOf(MediaNotFoundError);
  });

  it('creates settlement receipt signed reads only for ADMIN_ONLY media', async () => {
    const receipt = mediaRow({ accessClass: MediaAccessClass.ADMIN_ONLY });
    repository.findById.mockResolvedValueOnce(receipt);
    await storage.put({
      storageKey: receipt.storageKey,
      body: Buffer.from('receipt'),
      mimeType: 'image/jpeg',
    });

    const signed = await service.createSettlementReceiptRead(receipt.id);
    expect(signed.url).toContain('signed-test=1');
    expect(JSON.stringify(signed)).not.toContain('storageKey');
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      READ_TTLS.adminDefault * 1000 + 50,
    );

    repository.findById.mockResolvedValueOnce(
      mediaRow({ accessClass: MediaAccessClass.PUBLIC }),
    );
    await expect(
      service.createSettlementReceiptRead(randomUUID()),
    ).rejects.toBeInstanceOf(MediaNotFoundError);
  });

  it('maps missing settlement receipt objects to MEDIA_DELIVERY_FAILED', async () => {
    const receipt = mediaRow({ accessClass: MediaAccessClass.ADMIN_ONLY });
    repository.findById.mockResolvedValue(receipt);
    await expect(
      service.createSettlementReceiptRead(receipt.id),
    ).rejects.toBeInstanceOf(MediaDeliveryFailedError);
  });

  it('enforces accessClass on reference helpers', async () => {
    const tx = {} as never;
    const findByIdForReference = jest.fn();
    Object.assign(repository, { findByIdForReference });

    findByIdForReference.mockResolvedValueOnce(
      mediaRow({ accessClass: MediaAccessClass.PUBLIC }),
    );
    await expect(
      service.getReceiptReference(randomUUID(), tx),
    ).rejects.toBeInstanceOf(MediaUnsupportedTypeError);

    findByIdForReference.mockResolvedValueOnce(
      mediaRow({ accessClass: MediaAccessClass.ADMIN_ONLY }),
    );
    await expect(
      service.getImageReference(randomUUID(), tx),
    ).rejects.toBeInstanceOf(MediaUnsupportedTypeError);
  });

  it('omits ADMIN_ONLY media from public presentations', async () => {
    const publicId = randomUUID();
    const privateId = randomUUID();
    Object.assign(repository, {
      findByIds: jest
        .fn()
        .mockResolvedValue([
          mediaRow({ id: publicId, accessClass: MediaAccessClass.PUBLIC }),
          mediaRow({ id: privateId, accessClass: MediaAccessClass.ADMIN_ONLY }),
        ]),
    });

    const presentations = await service.presentations([publicId, privateId]);
    expect(presentations.has(publicId)).toBe(true);
    expect(presentations.get(publicId)?.url).toBe(
      `/api/v1/media/${publicId}/content`,
    );
    expect(presentations.has(privateId)).toBe(false);
  });
});
