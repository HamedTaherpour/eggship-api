import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminMediaController } from './api/admin-media.controller';
import { MediaContentController } from './api/media-content.controller';
import { MediaUploadExceptionFilter } from './api/media-upload.exception-filter';
import {
  MEDIA_READ_TTL_POLICY,
  MEDIA_UPLOAD_LIMITS,
  MediaService,
} from './application/media.service';
import type { MediaUploadLimits } from './domain/media-upload-limits';
import type { MediaReadTtlPolicy } from './domain/media';
import { MediaRepository } from './infrastructure/media.repository';
import {
  DEFAULT_PUBLIC_REDIRECT_TTL_SECONDS,
  DEFAULT_PUBLIC_REDIRECT_MIN_TTL_SECONDS,
  DEFAULT_PUBLIC_REDIRECT_MAX_TTL_SECONDS,
  DEFAULT_SENSITIVE_ADMIN_TTL_SECONDS,
  DEFAULT_SENSITIVE_ADMIN_MIN_TTL_SECONDS,
  DEFAULT_SENSITIVE_ADMIN_MAX_TTL_SECONDS,
} from '../../config/environment.validation';

/**
 * Reusable Media library (CAT-04). Owns metadata, upload validation, and
 * deletion. Object bytes live behind StorageProvider. Product/Blog attachment
 * is out of scope. AuthModule is imported only so Admin routes can resolve
 * AccessTokenGuard.
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    forwardRef(() => AuthModule),
    AuditModule,
  ],
  controllers: [AdminMediaController, MediaContentController],
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
    {
      provide: MEDIA_READ_TTL_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MediaReadTtlPolicy => ({
        publicDefault: config.get(
          'PUBLIC_REDIRECT_DEFAULT_TTL_SECONDS',
          DEFAULT_PUBLIC_REDIRECT_TTL_SECONDS,
        ),
        publicMin: config.get(
          'PUBLIC_REDIRECT_MIN_TTL_SECONDS',
          DEFAULT_PUBLIC_REDIRECT_MIN_TTL_SECONDS,
        ),
        publicMax: config.get(
          'PUBLIC_REDIRECT_MAX_TTL_SECONDS',
          DEFAULT_PUBLIC_REDIRECT_MAX_TTL_SECONDS,
        ),
        adminDefault: config.get(
          'SENSITIVE_ADMIN_DEFAULT_TTL_SECONDS',
          DEFAULT_SENSITIVE_ADMIN_TTL_SECONDS,
        ),
        adminMin: config.get(
          'SENSITIVE_ADMIN_MIN_TTL_SECONDS',
          DEFAULT_SENSITIVE_ADMIN_MIN_TTL_SECONDS,
        ),
        adminMax: config.get(
          'SENSITIVE_ADMIN_MAX_TTL_SECONDS',
          DEFAULT_SENSITIVE_ADMIN_MAX_TTL_SECONDS,
        ),
      }),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
