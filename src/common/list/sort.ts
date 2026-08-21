import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { SORT_ORDERS, type SortOrder } from './list.constants';

/** Neutral sort intent after validation and resource defaults. */
export interface SortRequest<TField extends string> {
  sortBy: TField;
  sortOrder: SortOrder;
}

export interface CreateSortQueryDtoOptions<
  TFields extends readonly [string, ...string[]],
> {
  /** Explicit allowlist of sortable fields for one resource. */
  fields: TFields;
  /** Resource-owned default when `sortBy` is omitted. */
  defaultSortBy: TFields[number];
  /** Resource-owned default when `sortOrder` is omitted. */
  defaultSortOrder?: SortOrder;
}

export interface SortQueryDtoClass<TField extends string> {
  new (): {
    sortBy?: TField;
    sortOrder?: SortOrder;
  };
}

export interface CreatedSortQueryDto<
  TFields extends readonly [string, ...string[]],
> {
  /** Validated query DTO class with allowlisted `sortBy` / `sortOrder`. */
  SortQueryDto: SortQueryDtoClass<TFields[number]>;
  /** Apply resource defaults after validation. */
  resolveSort: (query: {
    sortBy?: TFields[number];
    sortOrder?: SortOrder;
  }) => SortRequest<TFields[number]>;
  fields: TFields;
  defaultSortBy: TFields[number];
  defaultSortOrder: SortOrder;
}

/**
 * Build a resource-specific sort query DTO with a type-safe allowlist.
 *
 * Unknown `sortBy` values fail validation. Feature modules must map the
 * resulting field name to persistence explicitly — never pass client strings
 * into Prisma `orderBy` without an allowlist map.
 *
 * @example
 * ```ts
 * const PRODUCT_SORT_FIELDS = ['createdAt', 'updatedAt', 'price'] as const;
 * const { SortQueryDto, resolveSort } = createSortQueryDto({
 *   fields: PRODUCT_SORT_FIELDS,
 *   defaultSortBy: 'createdAt',
 *   defaultSortOrder: 'desc',
 * });
 * ```
 */
export function createSortQueryDto<
  const TFields extends readonly [string, ...string[]],
>(options: CreateSortQueryDtoOptions<TFields>): CreatedSortQueryDto<TFields> {
  const fields = options.fields;
  const defaultSortBy = options.defaultSortBy;
  const defaultSortOrder = options.defaultSortOrder ?? 'desc';
  const fieldList = [...fields];

  class SortQueryDto {
    @ApiPropertyOptional({
      enum: fieldList,
      default: defaultSortBy,
      description:
        'Allowlisted sort field for this resource. Unknown values are rejected.',
    })
    @IsOptional()
    @IsIn(fieldList)
    sortBy?: TFields[number];

    @ApiPropertyOptional({
      enum: [...SORT_ORDERS],
      default: defaultSortOrder,
      description: 'Sort direction. Only `asc` and `desc` are accepted.',
    })
    @IsOptional()
    @IsIn([...SORT_ORDERS])
    sortOrder?: SortOrder;
  }

  Object.defineProperty(SortQueryDto, 'name', {
    value: `SortQueryDto_${fields.join('_')}`,
  });

  function resolveSort(query: {
    sortBy?: TFields[number];
    sortOrder?: SortOrder;
  }): SortRequest<TFields[number]> {
    return {
      sortBy: query.sortBy ?? defaultSortBy,
      sortOrder: query.sortOrder ?? defaultSortOrder,
    };
  }

  return {
    SortQueryDto,
    resolveSort,
    fields,
    defaultSortBy,
    defaultSortOrder,
  };
}

export type { SortOrder };
