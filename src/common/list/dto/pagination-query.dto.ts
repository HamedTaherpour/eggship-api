import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../list.constants';
import { parseQueryInt } from '../parse-query-int';

/**
 * Reusable pagination query fields.
 *
 * Compose into resource list DTOs via `IntersectionType` or by extending this
 * class. Invalid values are rejected (not clamped). Defaults apply only when
 * the parameter is omitted — use {@link resolvePageRequest}.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      '1-based page index. Rejected when less than 1 or non-integer.',
    default: DEFAULT_PAGE,
    minimum: 1,
    type: Number,
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryInt(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: `Items per page. Default ${DEFAULT_PAGE_SIZE}; maximum ${MAX_PAGE_SIZE}. Values above the maximum are rejected, not clamped.`,
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    type: Number,
    example: 20,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryInt(value))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
