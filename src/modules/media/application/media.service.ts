import { Inject, Injectable } from '@nestjs/common';
import {
  resolvePageRequest,
  toPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/list';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { StorageProvider } from '../../../infrastructure/storage/storage-provider';
import { StorageProviderError } from '../../../infrastructure/storage/storage-provider';
import { STORAGE_PROVIDER } from '../../../infrastructure/storage/storage.tokens';
import type { MediaUploadLimits } from '../domain/media-upload-limits';
import { mapWithBoundedConcurrency } from '../domain/bounded-concurrency';
import { validateInboundMediaFile } from '../domain/file-validation';
import type {
  InboundMediaFile,
  MediaListQuery,
  MediaRecord,
  MediaUploadBatchResult,
  MediaUploadItemResult,
} from '../domain/media';
import {
  MediaDeleteFailedError,
  MediaBatchTooLargeError,
  MediaErrorCode,
  MediaFileTooLargeError,
  MediaNoFilesError,
  MediaNotFoundError,
  MediaTooManyFilesError,
  MediaUnsupportedTypeError,
  MediaUploadFailedError,
  mediaErrorBody,
} from '../domain/media-errors';
import { generateMediaStorageKey } from '../domain/storage-key';
import { MediaRepository } from '../infrastructure/media.repository';
import type { AdminMediaListQueryDto } from '../api/dto/admin-media-list-query.dto';
import { resolveAdminMediaSort } from '../api/dto/admin-media-list-query.dto';

export const MEDIA_UPLOAD_LIMITS = Symbol('MEDIA_UPLOAD_LIMITS');

@Injectable()
export class MediaService {
  constructor(
    private readonly media: MediaRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    @Inject(MEDIA_UPLOAD_LIMITS)
    private readonly limits: MediaUploadLimits,
    private readonly logger: ApplicationLogger,
  ) {}

  async listAdmin(
    query: AdminMediaListQueryDto,
  ): Promise<PaginatedResponse<MediaRecord>> {
    const pageRequest = resolvePageRequest(query);
    const sort = resolveAdminMediaSort(query);
    const page = await this.media.list(
      toMediaListQuery(query, pageRequest, sort),
    );
    return toPaginatedResponse(page.items, pageRequest, page.total);
  }

  async getAdminById(id: string): Promise<MediaRecord> {
    const found = await this.media.findById(id);
    if (found === null) {
      throw new MediaNotFoundError();
    }
    return found;
  }

  publicUrl(record: MediaRecord): string {
    return this.storage.getPublicUrl(record.storageKey);
  }

  async uploadBatch(
    files: InboundMediaFile[],
  ): Promise<MediaUploadBatchResult> {
    this.assertRequestBounds(files);

    const started = Date.now();
    const items = await mapWithBoundedConcurrency(
      files,
      this.limits.uploadConcurrency,
      async (file, index) => this.uploadOne(file, index),
    );

    const uploaded = items.filter((item) => item.status === 'uploaded').length;
    const failed = items.length - uploaded;
    this.logger.info(
      {
        module: 'media',
        operation: 'media.batch.completed',
        total: items.length,
        uploaded,
        failed,
        durationMs: Date.now() - started,
      },
      'Media batch upload completed',
    );

    return {
      items,
      summary: { total: items.length, uploaded, failed },
    };
  }

  async deleteAdmin(id: string): Promise<MediaRecord> {
    const existing = await this.media.findById(id);
    if (existing === null) {
      throw new MediaNotFoundError();
    }

    try {
      await this.storage.delete(existing.storageKey);
    } catch (error: unknown) {
      this.logger.error(
        {
          module: 'media',
          operation: 'media.deleted',
          mediaId: existing.id,
          outcome: 'storage_failed',
        },
        'Media object storage delete failed',
        toError(error),
      );
      throw new MediaDeleteFailedError();
    }

    const deleted = await this.deleteRowAfterObjectRemoved(existing);
    this.logger.info(
      {
        module: 'media',
        operation: 'media.deleted',
        mediaId: deleted.id,
      },
      'Media deleted',
    );
    return deleted;
  }

  private async deleteRowAfterObjectRemoved(
    existing: MediaRecord,
  ): Promise<MediaRecord> {
    try {
      const deleted = await this.media.deleteById(existing.id);
      if (deleted === null) {
        this.logger.info(
          {
            module: 'media',
            operation: 'media.deleted',
            mediaId: existing.id,
            outcome: 'already_removed',
          },
          'Media row already absent after object delete',
        );
        return existing;
      }
      return deleted;
    } catch (error: unknown) {
      this.logger.error(
        {
          module: 'media',
          operation: 'media.deleted',
          mediaId: existing.id,
          outcome: 'row_delete_failed',
        },
        'Media row delete failed after object delete',
        toError(error),
      );
      throw new MediaDeleteFailedError();
    }
  }

  private assertRequestBounds(files: InboundMediaFile[]): void {
    if (files.length === 0) {
      throw new MediaNoFilesError();
    }
    if (files.length > this.limits.maxFilesPerBatch) {
      throw new MediaTooManyFilesError();
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > this.limits.maxBatchBytes) {
      throw new MediaBatchTooLargeError();
    }
  }

  private async uploadOne(
    file: InboundMediaFile,
    index: number,
  ): Promise<MediaUploadItemResult> {
    try {
      const validated = validateInboundMediaFile(
        file,
        this.limits.maxFileBytes,
      );
      const storageKey = generateMediaStorageKey(validated.mimeType);

      await this.storage.put({
        storageKey,
        body: validated.buffer,
        mimeType: validated.mimeType,
      });

      try {
        const media = await this.media.create({
          storageKey,
          originalFileName: validated.originalFileName,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          width: validated.width,
          height: validated.height,
        });
        return { index, status: 'uploaded', media };
      } catch (error: unknown) {
        await this.bestEffortDeleteObject(storageKey);
        throw toUploadFailure(error);
      }
    } catch (error: unknown) {
      if (isUnexpectedUploadFailure(error)) {
        this.logger.error(
          {
            module: 'media',
            operation: 'media.upload.failed',
            index,
            errorCode:
              error instanceof ApplicationError
                ? error.code
                : MediaErrorCode.UPLOAD_FAILED,
          },
          'Media file upload failed',
          toError(error),
        );
      }
      return {
        index,
        status: 'failed',
        error: mediaErrorBody(toPerFileError(error)),
      };
    }
  }

  private async bestEffortDeleteObject(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error: unknown) {
      this.logger.error(
        {
          module: 'media',
          operation: 'media.upload.failed',
          reason: 'orphan_cleanup_failed',
        },
        'Best-effort object cleanup failed after Media row create failure',
        toError(error),
      );
    }
  }
}

function toMediaListQuery(
  query: AdminMediaListQueryDto,
  pageRequest: { page: number; pageSize: number },
  sort: {
    sortBy: MediaListQuery['sortBy'];
    sortOrder: MediaListQuery['sortOrder'];
  },
): MediaListQuery {
  return {
    page: pageRequest.page,
    pageSize: pageRequest.pageSize,
    search: query.search,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
    mimeType: query.mimeType,
    createdFrom:
      query.createdFrom === undefined ? undefined : new Date(query.createdFrom),
    createdTo:
      query.createdTo === undefined ? undefined : new Date(query.createdTo),
  };
}

function toPerFileError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }
  return toUploadFailure(error);
}

function toUploadFailure(error: unknown): MediaUploadFailedError {
  if (error instanceof MediaUploadFailedError) {
    return error;
  }
  if (
    error instanceof StorageProviderError ||
    (error instanceof Error && error.name === 'StorageProviderError')
  ) {
    return new MediaUploadFailedError();
  }
  return new MediaUploadFailedError();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unknown failure.');
}

function isUnexpectedUploadFailure(error: unknown): boolean {
  return !(
    error instanceof MediaUnsupportedTypeError ||
    error instanceof MediaFileTooLargeError
  );
}
