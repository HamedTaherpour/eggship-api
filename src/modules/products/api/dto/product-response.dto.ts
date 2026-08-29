import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { ProductRecord } from '../../domain/product';
import type { MediaPresentation } from '../../../media/domain/media-presentation';

/** Public storefront product fields. Price is integer Toman. */
export class PublicProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cage-free eggs (30)' })
  name!: string;

  @ApiProperty({
    description: 'Current selling price in integer Toman (not Rial).',
    example: 625000,
    type: Number,
  })
  price!: number;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  imageMediaId?: string | null;
  @ApiProperty({ type: Object, nullable: true })
  image!: MediaPresentation | null;
}

/** Admin product fields including lifecycle timestamps. */
export class AdminProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Cage-free eggs (30)' })
  name!: string;

  @ApiProperty({
    description: 'Current selling price in integer Toman (not Rial).',
    example: 625000,
    type: Number,
  })
  price!: number;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;
  @ApiProperty({ format: 'uuid', nullable: true, required: false })
  imageMediaId?: string | null;
  @ApiProperty({ type: Object, nullable: true })
  image!: MediaPresentation | null;
}

export class PublicProductResponseDto {
  @ApiProperty({ type: PublicProductDto })
  data!: PublicProductDto;
}

export class AdminProductResponseDto {
  @ApiProperty({ type: AdminProductDto })
  data!: AdminProductDto;
}

export const PublicProductListResponseDto = createPaginatedResponseDto(
  PublicProductDto,
  { name: 'PublicProductListResponseDto' },
);

export const AdminProductListResponseDto = createPaginatedResponseDto(
  AdminProductDto,
  { name: 'AdminProductListResponseDto' },
);

export function toPublicProductDto(record: ProductRecord): PublicProductDto {
  return {
    id: record.id,
    name: record.name,
    price: record.price,
    categoryId: record.categoryId,
    ...(record.imageMediaId ? { imageMediaId: record.imageMediaId } : {}),
    image: record.image ?? null,
  };
}

export function toAdminProductDto(record: ProductRecord): AdminProductDto {
  return {
    id: record.id,
    name: record.name,
    price: record.price,
    categoryId: record.categoryId,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.imageMediaId ? { imageMediaId: record.imageMediaId } : {}),
    image: record.image ?? null,
  };
}
