import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { AdminMediaController } from './api/admin-media.controller';
import { MediaUploadExceptionFilter } from './api/media-upload.exception-filter';
import { MEDIA_UPLOAD_LIMITS, MediaService } from './application/media.service';
import type { MediaUploadLimits } from './domain/media-upload-limits';
import { MediaRepository } from './infrastructure/media.repository';

/**
 * Reusable Media library (CAT-04). Owns metadata, upload validation, and
 * deletion. Object bytes live behind StorageProvider. Product/Blog attachment
 * is out of scope. AuthModule is imported only so Admin routes can resolve
 * AccessTokenGuard.
 */
@Module({
  imports: [PrismaModule, StorageModule, forwardRef(() => AuthModule)],
  controllers: [AdminMediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaUploadExceptionFilter,
    {
      provide: MEDIA_UPLOAD_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MediaUploadLimits => ({
        maxFileBytes: config.getOrThrow<number>('MEDIA_MAX_FILE_BYTES'),
        maxFilesPerBatch: config.getOrThrow<number>(
          'MEDIA_MAX_FILES_PER_BATCH',
        ),
        maxBatchBytes: config.getOrThrow<number>('MEDIA_MAX_BATCH_BYTES'),
        uploadConcurrency: config.getOrThrow<number>(
          'MEDIA_UPLOAD_CONCURRENCY',
        ),
      }),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
