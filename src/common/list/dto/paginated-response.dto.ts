import { ApiProperty } from '@nestjs/swagger';
import type { Type } from '@nestjs/common';
import { PaginationMetaDto } from '../../openapi/dto/common-response.dto';

/**
 * Build a lightweight paginated response DTO for OpenAPI documentation.
 * Does not introduce a generic CRUD framework — only schema composition.
 */
export function createPaginatedResponseDto<TModel extends Type<unknown>>(
  itemType: TModel,
  options?: { name?: string },
): Type<{ data: InstanceType<TModel>[]; meta: PaginationMetaDto }> {
  class PaginatedResponseDto {
    @ApiProperty({
      type: itemType,
      isArray: true,
      description: 'Page of resource items.',
    })
    data!: InstanceType<TModel>[];

    @ApiProperty({ type: PaginationMetaDto })
    meta!: PaginationMetaDto;
  }

  Object.defineProperty(PaginatedResponseDto, 'name', {
    value: options?.name ?? `Paginated${itemType.name}ResponseDto`,
  });

  return PaginatedResponseDto;
}
