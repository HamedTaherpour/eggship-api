import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DEFAULT_SEARCH_MAX_LENGTH } from '../list.constants';
import { normalizeSearch } from '../search';

/**
 * Reusable optional `search` query field.
 *
 * Trimmed; whitespace-only becomes absent. Domain-specific normalization
 * (phone, SKU, …) belongs in the owning module — not here.
 * Resources decide which fields are searchable.
 */
export class SearchQueryDto {
  @ApiPropertyOptional({
    description:
      'Optional free-text search. Trimmed; empty or whitespace-only is treated as absent. Searchable fields are resource-specific.',
    maxLength: DEFAULT_SEARCH_MAX_LENGTH,
    type: String,
    example: 'acme',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeSearch(value))
  @IsString()
  @MaxLength(DEFAULT_SEARCH_MAX_LENGTH)
  search?: string;
}
