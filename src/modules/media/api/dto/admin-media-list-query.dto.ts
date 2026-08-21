import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  SearchQueryDto,
} from '../../../../common/list';
import { ACCEPTED_MEDIA_MIME_TYPES } from '../../domain/accepted-media-types';

export const ADMIN_MEDIA_SORT_FIELDS = [
  'createdAt',
  'originalFileName',
  'sizeBytes',
] as const;

const adminMediaSort = createSortQueryDto({
  fields: ADMIN_MEDIA_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

export const resolveAdminMediaSort = adminMediaSort.resolveSort;

class AdminMediaFiltersDto {
  @ApiPropertyOptional({
    description: 'When set, restrict to this accepted image MIME type.',
    enum: ACCEPTED_MEDIA_MIME_TYPES,
    example: 'image/jpeg',
  })
  @IsOptional()
  @IsIn(ACCEPTED_MEDIA_MIME_TYPES)
  mimeType?: (typeof ACCEPTED_MEDIA_MIME_TYPES)[number];

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on createdAt (ISO 8601 UTC). Example: 2026-01-01T00:00:00.000Z',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on createdAt (ISO 8601 UTC). Example: 2026-12-31T23:59:59.999Z',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsISO8601()
  createdTo?: string;
}

/**
 * Admin Media list query: pagination + search (originalFileName) + sort
 * allowlist + optional mimeType and createdAt range.
 * storageKey is not searchable.
 */
export class AdminMediaListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  adminMediaSort.SortQueryDto,
  AdminMediaFiltersDto,
) {}
