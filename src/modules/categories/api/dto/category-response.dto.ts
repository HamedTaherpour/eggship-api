import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { CategoryRecord } from '../../domain/category';

/** Public storefront category fields. */
export class PublicCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dairy' })
  name!: string;
}

/** Admin category fields including lifecycle timestamps. */
export class AdminCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dairy' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;
}

export class PublicCategoryListResponseDto {
  @ApiProperty({ type: PublicCategoryDto, isArray: true })
  data!: PublicCategoryDto[];
}

export class AdminCategoryResponseDto {
  @ApiProperty({ type: AdminCategoryDto })
  data!: AdminCategoryDto;
}

export const AdminCategoryListResponseDto = createPaginatedResponseDto(
  AdminCategoryDto,
  { name: 'AdminCategoryListResponseDto' },
);

export function toPublicCategoryDto(record: CategoryRecord): PublicCategoryDto {
  return { id: record.id, name: record.name };
}

export function toAdminCategoryDto(record: CategoryRecord): AdminCategoryDto {
  return {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
