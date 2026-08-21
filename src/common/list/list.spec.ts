import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, validate } from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SEARCH_MAX_LENGTH,
  MAX_PAGE_SIZE,
} from './list.constants';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { parseQueryBoolean } from './parse-query-boolean';
import { parseQueryInt } from './parse-query-int';
import {
  buildPaginationMeta,
  calculateTotalPages,
  resolvePageRequest,
  toPaginatedResponse,
  toSkipTake,
} from './pagination';
import { normalizeSearch } from './search';
import { createSortQueryDto } from './sort';

describe('parseQueryInt', () => {
  it('returns undefined for absent or empty values', () => {
    expect(parseQueryInt(undefined)).toBeUndefined();
    expect(parseQueryInt(null)).toBeUndefined();
    expect(parseQueryInt('')).toBeUndefined();
  });

  it('parses decimal integer strings', () => {
    expect(parseQueryInt('1')).toBe(1);
    expect(parseQueryInt('20')).toBe(20);
    expect(parseQueryInt('0')).toBe(0);
    expect(parseQueryInt('-1')).toBe(-1);
  });

  it('rejects decimals, junk, scientific notation, and non-finite values', () => {
    expect(Number.isNaN(parseQueryInt('1.5') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt('2foo') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt('1e2') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt('0x10') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt('NaN') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt('Infinity') as number)).toBe(true);
    expect(Number.isNaN(parseQueryInt(Number.NaN))).toBe(true);
    expect(Number.isNaN(parseQueryInt(Number.POSITIVE_INFINITY))).toBe(true);
    expect(Number.isNaN(parseQueryInt(2.5))).toBe(true);
  });

  it('accepts already-safe integers', () => {
    expect(parseQueryInt(42)).toBe(42);
  });
});

describe('parseQueryBoolean', () => {
  it('accepts only true/false boolean or lowercase string', () => {
    expect(parseQueryBoolean(true)).toBe(true);
    expect(parseQueryBoolean(false)).toBe(false);
    expect(parseQueryBoolean('true')).toBe(true);
    expect(parseQueryBoolean('false')).toBe(false);
  });

  it('leaves non-canonical values unchanged for validators to reject', () => {
    expect(parseQueryBoolean('1')).toBe('1');
    expect(parseQueryBoolean('yes')).toBe('yes');
    expect(parseQueryBoolean('TRUE')).toBe('TRUE');
    expect(parseQueryBoolean(1)).toBe(1);
  });

  it('treats empty as absent', () => {
    expect(parseQueryBoolean(undefined)).toBeUndefined();
    expect(parseQueryBoolean('')).toBeUndefined();
  });
});

describe('normalizeSearch', () => {
  it('returns undefined when absent', () => {
    expect(normalizeSearch(undefined)).toBeUndefined();
    expect(normalizeSearch(null)).toBeUndefined();
  });

  it('trims and treats whitespace-only as absent', () => {
    expect(normalizeSearch('  acme  ')).toBe('acme');
    expect(normalizeSearch('   ')).toBeUndefined();
    expect(normalizeSearch('\t\n')).toBeUndefined();
  });

  it('does not apply domain-specific normalization', () => {
    expect(normalizeSearch('0912 123 4567')).toBe('0912 123 4567');
    expect(normalizeSearch('Acme-SKU')).toBe('Acme-SKU');
  });

  it('preserves overlong trimmed values for MaxLength validation', () => {
    const long = 'a'.repeat(DEFAULT_SEARCH_MAX_LENGTH + 1);
    expect(
      normalizeSearch(long, { maxLength: DEFAULT_SEARCH_MAX_LENGTH }),
    ).toBe(long);
  });

  it('passes non-strings through unchanged', () => {
    expect(normalizeSearch(12)).toBe(12);
  });
});

describe('pagination helpers', () => {
  it('applies defaults without mutating input', () => {
    const input = {};
    const resolved = resolvePageRequest(input);
    expect(resolved).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(input).toEqual({});
  });

  it('preserves explicit page values', () => {
    expect(resolvePageRequest({ page: 3, pageSize: 50 })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('computes skip/take', () => {
    expect(toSkipTake({ page: 1, pageSize: 20 })).toEqual({
      skip: 0,
      take: 20,
    });
    expect(toSkipTake({ page: 3, pageSize: 10 })).toEqual({
      skip: 20,
      take: 10,
    });
  });

  it('computes totalPages including zero total', () => {
    expect(calculateTotalPages(0, 20)).toBe(0);
    expect(calculateTotalPages(1, 20)).toBe(1);
    expect(calculateTotalPages(20, 20)).toBe(1);
    expect(calculateTotalPages(21, 20)).toBe(2);
    expect(calculateTotalPages(100, MAX_PAGE_SIZE)).toBe(1);
  });

  it('builds pagination meta and response without mutating items', () => {
    const items = Object.freeze([{ id: 'a' }, { id: 'b' }]);
    const pageRequest = { page: 1, pageSize: 20 };
    const response = toPaginatedResponse(items, pageRequest, 2);

    expect(response).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      meta: {
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
      },
    });
    expect(response.data).not.toBe(items);
    expect(buildPaginationMeta(pageRequest, 0)).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });
});

describe('createSortQueryDto', () => {
  const SORT_FIELDS = ['createdAt', 'title'] as const;
  const { resolveSort, fields } = createSortQueryDto({
    fields: SORT_FIELDS,
    defaultSortBy: 'createdAt',
    defaultSortOrder: 'desc',
  });

  it('exposes the allowlist and applies resource defaults', () => {
    expect(fields).toEqual(SORT_FIELDS);
    expect(resolveSort({})).toEqual({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(resolveSort({ sortBy: 'title', sortOrder: 'asc' })).toEqual({
      sortBy: 'title',
      sortOrder: 'asc',
    });
  });

  it('does not mutate the query object when resolving defaults', () => {
    const query = { sortBy: 'title' as const };
    resolveSort(query);
    expect(query).toEqual({ sortBy: 'title' });
  });
});

const probeSort = createSortQueryDto({
  fields: ['createdAt', 'title'] as const,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

class ProbeFilterDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

class ListProbeQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  probeSort.SortQueryDto,
  ProbeFilterDto,
) {}

async function validateQuery(
  input: Record<string, unknown>,
): Promise<{ dto: ListProbeQueryDto; errors: string[] }> {
  const dto = plainToInstance(ListProbeQueryDto, input);
  const validationErrors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const errors = validationErrors.flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { dto, errors };
}

describe('list query DTO validation', () => {
  it('accepts defaults when pagination is omitted', async () => {
    const { dto, errors } = await validateQuery({});
    expect(errors).toEqual([]);
    expect(resolvePageRequest(dto)).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(probeSort.resolveSort(dto)).toEqual({
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('accepts a normal page', async () => {
    const { dto, errors } = await validateQuery({ page: '2', pageSize: '10' });
    expect(errors).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
  });

  it('rejects page zero, negative, decimal, and malformed numbers', async () => {
    for (const page of ['0', '-1', '1.5', '2foo', 'NaN', 'Infinity']) {
      const { errors } = await validateQuery({ page });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects pageSize above the maximum', async () => {
    const { errors } = await validateQuery({ pageSize: '101' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid sortOrder and unknown sortBy', async () => {
    const invalidOrder = await validateQuery({ sortOrder: 'random' });
    expect(invalidOrder.errors.length).toBeGreaterThan(0);

    const unknownField = await validateQuery({ sortBy: 'notAllowed' });
    expect(unknownField.errors.length).toBeGreaterThan(0);
  });

  it('accepts allowlisted sort values', async () => {
    const { dto, errors } = await validateQuery({
      sortBy: 'title',
      sortOrder: 'asc',
    });
    expect(errors).toEqual([]);
    expect(dto.sortBy).toBe('title');
    expect(dto.sortOrder).toBe('asc');
  });

  it('trims search and rejects overlong search', async () => {
    const trimmed = await validateQuery({ search: '  hello  ' });
    expect(trimmed.errors).toEqual([]);
    expect(trimmed.dto.search).toBe('hello');

    const whitespace = await validateQuery({ search: '   ' });
    expect(whitespace.errors).toEqual([]);
    expect(whitespace.dto.search).toBeUndefined();

    const tooLong = await validateQuery({
      search: 'x'.repeat(DEFAULT_SEARCH_MAX_LENGTH + 1),
    });
    expect(tooLong.errors.length).toBeGreaterThan(0);
  });

  it('parses strict booleans and rejects non-canonical values', async () => {
    const ok = await validateQuery({ isActive: 'true' });
    expect(ok.errors).toEqual([]);
    expect(ok.dto.isActive).toBe(true);

    const bad = await validateQuery({ isActive: 'yes' });
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown query properties', async () => {
    const { errors } = await validateQuery({ randomInternalThing: '1' });
    expect(errors.some((message) => message.includes('should not exist'))).toBe(
      true,
    );
  });
});
