import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorBodyDto {
  @ApiProperty({
    example: 'BAD_REQUEST',
    description: 'Stable machine-readable error code.',
  })
  code!: string;

  @ApiProperty({
    example: 'Request validation failed.',
    description:
      'Human-readable message; clients must not parse this for logic.',
  })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      violations: ['property unexpected should not exist'],
    },
    description:
      'Optional structured details. Validation failures use a violations array.',
  })
  details!: Record<string, unknown>;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;

  @ApiProperty({
    example: 'req_00000000-0000-4000-8000-000000000000',
    description: 'Same value as the X-Request-Id response header.',
  })
  requestId!: string;
}

export class ApiInternalErrorResponseDto {
  @ApiProperty({
    type: ApiErrorBodyDto,
    example: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: {},
    },
  })
  error!: ApiErrorBodyDto;

  @ApiProperty({
    example: 'req_00000000-0000-4000-8000-000000000000',
  })
  requestId!: string;
}

/** Canonical list response metadata (`meta` on paginated envelopes). */
export class PaginationMetaDto {
  @ApiProperty({ example: 1, minimum: 1 })
  page!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ example: 0, minimum: 0 })
  total!: number;

  @ApiProperty({ example: 0, minimum: 0 })
  totalPages!: number;
}

export class ExamplePaginatedResponseDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [],
  })
  data!: unknown[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
