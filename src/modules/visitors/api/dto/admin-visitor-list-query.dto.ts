import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  SearchQueryDto,
} from '../../../../common/list';

export const ADMIN_VISITOR_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'referralCode',
] as const;
const visitorSort = createSortQueryDto({
  fields: ADMIN_VISITOR_SORT_FIELDS,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});
export const resolveAdminVisitorSort = visitorSort.resolveSort;

class AdminVisitorFiltersDto {
  @ApiPropertyOptional({ type: Boolean, example: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: 'Whether the visitor has immutable registration attributions.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  hasAttributions?: boolean;
}

export class AdminVisitorListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  visitorSort.SortQueryDto,
  AdminVisitorFiltersDto,
) {}

export const ADMIN_REFERRAL_SORT_FIELDS = [
  'attributedAt',
  'referralCode',
] as const;
const referralSort = createSortQueryDto({
  fields: ADMIN_REFERRAL_SORT_FIELDS,
  defaultSortBy: 'attributedAt',
  defaultSortOrder: 'desc',
});
export const resolveAdminReferralSort = referralSort.resolveSort;

export class AdminReferralEvidenceListQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  referralSort.SortQueryDto,
) {}
