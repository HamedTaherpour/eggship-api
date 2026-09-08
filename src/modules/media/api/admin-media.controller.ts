import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  Body,
  UseFilters,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { MediaService } from '../application/media.service';
import type { InboundMediaFile, MediaUploadItemResult } from '../domain/media';
import { MediaAccessClass } from '../domain/media';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  HARD_MEDIA_MAX_BATCH_BYTES,
  HARD_MEDIA_MAX_FILE_BYTES,
  HARD_MEDIA_MAX_FILES_PER_BATCH,
} from '../domain/media-upload-limits';
import { AdminMediaListQueryDto } from './dto/admin-media-list-query.dto';
import {
  AdminMediaListResponseDto,
  AdminMediaResponseDto,
  toAdminMediaDto,
} from './dto/media-response.dto';
import {
  MediaUploadBatchResponseDto,
  type MediaUploadItemDto,
} from './dto/media-upload-response.dto';
import { createBoundedMemoryStorage } from './bounded-memory-storage';
import { MediaUploadExceptionFilter } from './media-upload.exception-filter';
import type { Request } from 'express';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const UPLOAD_FIELD = 'files';
const uploadMemoryStorage = createBoundedMemoryStorage({
  maxFileBytes: HARD_MEDIA_MAX_FILE_BYTES,
  maxBatchBytes: HARD_MEDIA_MAX_BATCH_BYTES,
});

class AdminMediaUploadBodyDto {
  @ApiProperty({ enum: MediaAccessClass })
  @IsEnum(MediaAccessClass)
  accessClass!: MediaAccessClass;
}

@ApiTags('AdminMedia')
@Controller('admin/media')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @RequirePermissions(Permission.MEDIA_READ)
  @ApiOperation({
    operationId: 'AdminMedia_list',
    summary: 'List media library items (Admin)',
    description: [
      'Paginated Admin Media Library list.',
      'Search matches originalFileName only (not storageKey).',
      'Sort allowlist: createdAt, originalFileName, sizeBytes (default createdAt desc).',
      'Optional filters: mimeType, createdFrom, createdTo (inclusive ISO 8601).',
      'Requires MEDIA_READ.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated media metadata.',
    type: AdminMediaListResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminMediaListQueryDto,
  ): Promise<InstanceType<typeof AdminMediaListResponseDto>> {
    const page = await this.media.listAdmin(query);
    return {
      data: page.data.map((row) =>
        toAdminMediaDto(
          row,
          row.accessClass === MediaAccessClass.PUBLIC
            ? this.media.contentUrl(row.id)
            : null,
        ),
      ),
      meta: page.meta,
    };
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.MEDIA_MANAGE)
  @UseFilters(MediaUploadExceptionFilter)
  @UseInterceptors(
    FilesInterceptor(UPLOAD_FIELD, HARD_MEDIA_MAX_FILES_PER_BATCH, {
      storage: uploadMemoryStorage,
      limits: {
        files: HARD_MEDIA_MAX_FILES_PER_BATCH,
        fileSize: HARD_MEDIA_MAX_FILE_BYTES,
        fields: 2,
        fieldNameSize: 64,
        fieldSize: 1024,
        parts: HARD_MEDIA_MAX_FILES_PER_BATCH + 4,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'AdminMedia_upload',
    summary: 'Upload one or more media files (Admin)',
    description: [
      'Multipart field `files` (repeat the field for multiple files).',
      'Single-file and batch share this endpoint. Files are independent: a failed file does not roll back successes.',
      'Accepted batch with mixed per-file outcomes returns HTTP 200 and item statuses.',
      'Request-level failures (no files, too many files, aggregate too large, multer hard limits) return 4xx.',
      'Accepted types: image/jpeg, image/png, image/webp. SVG is rejected. One accessClass is required for the complete batch.',
      'Requires MEDIA_MANAGE.',
    ].join(' '),
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files', 'accessClass'],
      properties: {
        accessClass: { type: 'string', enum: Object.values(MediaAccessClass) },
        files: {
          type: 'array',
          maxItems: HARD_MEDIA_MAX_FILES_PER_BATCH,
          items: { type: 'string', format: 'binary' },
          description:
            'One or more image files. Launch default is 10 files / 5 MiB each / 25 MiB aggregate; multer hard-caps 20 files / 20 MiB each.',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Per-file upload results. HTTP 200 even when some items failed.',
    type: MediaUploadBatchResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async upload(
    @Body() body: AdminMediaUploadBodyDto,
    @UploadedFiles() files: UploadedFile[] | undefined,
  ): Promise<MediaUploadBatchResponseDto> {
    const inbound = (files ?? []).map(toInboundFile);
    const batch = await this.media.uploadBatch(inbound, body.accessClass);
    return {
      data: {
        items: batch.items.map((item) => this.toUploadItemDto(item)),
        summary: batch.summary,
      },
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.MEDIA_READ)
  @ApiOperation({
    operationId: 'AdminMedia_get',
    summary: 'Get media library item (Admin)',
    description:
      'Returns Media metadata and derived public URL. Requires MEDIA_READ. MEDIA_NOT_FOUND when missing.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Media item.', type: AdminMediaResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminMediaResponseDto> {
    const record = await this.media.getAdminById(id);
    return {
      data: toAdminMediaDto(
        record,
        record.accessClass === MediaAccessClass.PUBLIC
          ? this.media.contentUrl(record.id)
          : null,
      ),
    };
  }

  @Get(':id/usages')
  @RequirePermissions(Permission.MEDIA_READ)
  @ApiOperation({
    operationId: 'AdminMedia_usages',
    summary: 'Inspect durable Media references (Admin)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Stable, deterministic Media usage records.' })
  async usages(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: Array<{ type: string; id: string }> }> {
    return { data: await this.media.usages(id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.MEDIA_MANAGE)
  @ApiOperation({
    operationId: 'AdminMedia_delete',
    summary: 'Delete a media library item (Admin)',
    description: [
      'Rejects MEDIA_REFERENCED before storage deletion when the item is a settlement receipt. Otherwise deletes the object first, then the Media row. Missing-key object delete is success so retry can finish. Concurrent delete of the same id is idempotent (200). If object deletion fails, the row is kept and MEDIA_DELETE_FAILED is returned. Requires MEDIA_MANAGE.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Deleted media metadata.',
    type: AdminMediaResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminMediaResponseDto> {
    const deleted = await this.media.deleteAdmin(
      id,
      getAuthenticatedPrincipal(request)!.subjectId,
    );
    return {
      data: toAdminMediaDto(
        deleted,
        deleted.accessClass === MediaAccessClass.PUBLIC
          ? this.media.contentUrl(deleted.id)
          : null,
      ),
    };
  }

  private toUploadItemDto(item: MediaUploadItemResult): MediaUploadItemDto {
    if (item.status === 'uploaded') {
      return {
        index: item.index,
        status: 'uploaded',
        media: toAdminMediaDto(
          item.media,
          item.media.accessClass === MediaAccessClass.PUBLIC
            ? this.media.contentUrl(item.media.id)
            : null,
        ),
      };
    }
    return {
      index: item.index,
      status: 'failed',
      error: item.error,
    };
  }
}

function toInboundFile(file: UploadedFile): InboundMediaFile {
  return {
    originalName: file.originalname,
    claimedMimeType: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  };
}
