import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { RegionRecord } from '../../domain/region';

/** Public storefront region fields. */
export class PublicRegionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Tehran' })
  name!: string;
}

/** Admin region fields including lifecycle timestamps. */
export class AdminRegionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Tehran' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;
}

export class PublicRegionListResponseDto {
  @ApiProperty({ type: PublicRegionDto, isArray: true })
  data!: PublicRegionDto[];
}

export class AdminRegionResponseDto {
  @ApiProperty({ type: AdminRegionDto })
  data!: AdminRegionDto;
}

export const AdminRegionListResponseDto = createPaginatedResponseDto(
  AdminRegionDto,
  { name: 'AdminRegionListResponseDto' },
);

export function toPublicRegionDto(record: RegionRecord): PublicRegionDto {
  return { id: record.id, name: record.name };
}

export function toAdminRegionDto(record: RegionRecord): AdminRegionDto {
  return {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
