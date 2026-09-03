import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import {
  AdminRole,
  ALL_ADMIN_ROLES,
} from '../../../../common/authz/admin-role';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

const sort = createSortQueryDto({
  fields: ['email', 'createdAt', 'updatedAt'] as const,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

class AdminFiltersDto {
  @ApiPropertyOptional({ enum: ALL_ADMIN_ROLES })
  @IsOptional()
  @IsIn(ALL_ADMIN_ROLES)
  role?: AdminRole;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

export class AdminListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  sort.SortQueryDto,
  AdminFiltersDto,
) {}

export const resolveAdminSort = sort.resolveSort;
