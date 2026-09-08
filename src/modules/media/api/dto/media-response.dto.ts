import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { MediaRecord } from '../../domain/media';
import { MediaAccessClass } from '../../domain/media';

/** Admin Media Library fields. `url` is derived; storageKey is not exposed. */
export class AdminMediaDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  id!: string;

  @ApiProperty({ enum: MediaAccessClass })
  accessClass!: MediaRecord['accessClass'];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Stable application-owned content URL for PUBLIC media; null for ADMIN_ONLY media.',
  })
  url!: string | null;

  @ApiProperty({ example: 'cage-free-eggs.jpg' })
  originalFileName!: string;

  @ApiProperty({
    example: 'image/jpeg',
    enum: ['image/jpeg', 'image/png', 'image/webp'],
  })
  mimeType!: string;

  @ApiProperty({ example: 24576, type: Number })
  sizeBytes!: number;

  @ApiProperty({ example: 800, type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ example: 600, type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;
}

export class AdminMediaResponseDto {
  @ApiProperty({ type: AdminMediaDto })
  data!: AdminMediaDto;
}

export const AdminMediaListResponseDto = createPaginatedResponseDto(
  AdminMediaDto,
  { name: 'AdminMediaListResponseDto' },
);

export function toAdminMediaDto(
  record: MediaRecord,
  url: string | null,
): AdminMediaDto {
  return {
    id: record.id,
    accessClass: record.accessClass,
    url,
    originalFileName: record.originalFileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
