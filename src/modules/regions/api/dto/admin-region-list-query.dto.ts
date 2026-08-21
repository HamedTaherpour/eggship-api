import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const REGION_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

const regionSort = createSortQueryDto({
  fields: REGION_SORT_FIELDS,
  defaultSortBy: 'name',
  defaultSortOrder: 'asc',
});

export const resolveRegionSort = regionSort.resolveSort;

class RegionIsActiveFilterDto {
  @ApiPropertyOptional({
    description:
      'When set, restrict to active (`true`) or inactive (`false`) regions. Accepts only `true` / `false`.',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Admin Region list query: pagination + search (name) + sort allowlist + isActive.
 */
export class AdminRegionListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  regionSort.SortQueryDto,
  RegionIsActiveFilterDto,
) {}
