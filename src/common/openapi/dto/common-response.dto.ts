import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorBodyDto {
  @ApiProperty({
    example: 'BAD_REQUEST',
    description: 'Stable machine-readable error code.',
  })
  code!: string;

  @ApiProperty({
    example: 'اطلاعات واردشده معتبر نیست.',
    description:
      'Human-readable message; clients must not parse this for logic.',
  })
  message!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      violations: [
        {
          field: 'phone',
          rule: 'isIranianMobilePhone',
          message: 'شماره موبایل واردشده معتبر نیست.',
        },
      ],
    },
    description:
      'Safe contract details. Validation failures use violations with field, rule, and Persian message.',
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

export class ApiValidationViolationDto {
  @ApiProperty({ example: 'phone' })
  field!: string;

  @ApiProperty({ example: 'isIranianMobilePhone' })
  rule!: string;

  @ApiProperty({ example: 'شماره موبایل واردشده معتبر نیست.' })
  message!: string;
}

export class ApiValidationErrorDetailsDto {
  @ApiProperty({ type: ApiValidationViolationDto, isArray: true })
  violations!: ApiValidationViolationDto[];
}

export class ApiValidationErrorResponseDto {
  @ApiProperty({
    type: ApiErrorBodyDto,
    example: {
      code: 'VALIDATION_ERROR',
      message: 'اطلاعات واردشده معتبر نیست.',
      details: {
        violations: [
          {
            field: 'phone',
            rule: 'isIranianMobilePhone',
            message: 'شماره موبایل واردشده معتبر نیست.',
          },
        ],
      },
    },
  })
  error!: ApiErrorBodyDto;

  @ApiProperty({ example: 'req_00000000-0000-4000-8000-000000000000' })
  requestId!: string;
}

export class ApiInternalErrorResponseDto {
  @ApiProperty({
    type: ApiErrorBodyDto,
    example: {
      code: 'INTERNAL_ERROR',
      message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
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
