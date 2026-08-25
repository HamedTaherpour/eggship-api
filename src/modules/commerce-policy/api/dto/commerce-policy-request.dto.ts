import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  CommerceOverrideMode,
  MINIMUM_ORDER_QUANTITY_MAX,
  type CommerceOverrideInput,
  type CommerceSettingsInput,
} from '../../domain/commerce-policy';
import {
  CommerceOverrideInvalidError,
  CommercePolicyInvalidSettingsError,
} from '../../domain/commerce-policy-errors';
import { parseLocalTime } from '../../domain/commerce-policy';

const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export class CommerceSettingsBodyDto {
  @ApiProperty({
    description:
      'When false, regular fallback is always open; date overrides still apply.',
  })
  @IsBoolean()
  orderingScheduleEnabled!: boolean;

  @ApiProperty({
    example: '07:00',
    pattern: TIME_PATTERN,
    description: 'Asia/Tehran local wall-clock time at minute precision.',
  })
  @IsString()
  orderingOpensAt!: string;

  @ApiProperty({
    example: '16:00',
    pattern: TIME_PATTERN,
    description: 'Exclusive local closing time. Cross-midnight is supported.',
  })
  @IsString()
  orderingClosesAt!: string;

  @ApiProperty({ minimum: 1, maximum: MINIMUM_ORDER_QUANTITY_MAX, example: 5 })
  @IsInt()
  @Min(1)
  @Max(MINIMUM_ORDER_QUANTITY_MAX)
  minimumOrderQuantity!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'Use 0 only for initialization; later mutations require the current positive revision.',
  })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class CommerceOverrideBodyDto {
  @ApiProperty({ enum: Object.values(CommerceOverrideMode) })
  @IsIn(Object.values(CommerceOverrideMode))
  mode!: CommerceOverrideMode;

  @ApiPropertyOptional({
    example: '18:00',
    pattern: TIME_PATTERN,
    nullable: true,
    description: 'Required only for SPECIAL_HOURS; forbidden for CLOSED.',
  })
  @IsOptional()
  @IsString()
  opensAt?: string | null;

  @ApiPropertyOptional({
    example: '02:00',
    pattern: TIME_PATTERN,
    nullable: true,
    description: 'Required only for SPECIAL_HOURS; forbidden for CLOSED.',
  })
  @IsOptional()
  @IsString()
  closesAt?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class RemoveCommerceOverrideBodyDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class CommerceOverrideRangeQueryDto {
  @ApiProperty({ example: '2026-08-01', pattern: DATE_PATTERN })
  @Matches(new RegExp(DATE_PATTERN, 'u'))
  from!: string;

  @ApiProperty({ example: '2026-12-31', pattern: DATE_PATTERN })
  @Matches(new RegExp(DATE_PATTERN, 'u'))
  to!: string;
}

export function toSettingsInput(
  body: CommerceSettingsBodyDto,
): CommerceSettingsInput {
  try {
    return {
      orderingScheduleEnabled: body.orderingScheduleEnabled,
      orderingOpensAtLocalMinute: parseLocalTime(body.orderingOpensAt),
      orderingClosesAtLocalMinute: parseLocalTime(body.orderingClosesAt),
      minimumOrderQuantity: body.minimumOrderQuantity,
    };
  } catch {
    throw new CommercePolicyInvalidSettingsError(
      'Opening and closing times must use HH:mm at minute precision.',
    );
  }
}

export function toOverrideInput(
  body: CommerceOverrideBodyDto,
): CommerceOverrideInput {
  if (body.mode === CommerceOverrideMode.CLOSED) {
    if (body.opensAt !== undefined || body.closesAt !== undefined)
      throw new CommerceOverrideInvalidError(
        'CLOSED overrides must not include hours.',
      );
    return {
      mode: body.mode,
      opensAtLocalMinute: null,
      closesAtLocalMinute: null,
    };
  }
  if (
    body.opensAt === undefined ||
    body.closesAt === undefined ||
    body.opensAt === null ||
    body.closesAt === null
  )
    throw new CommerceOverrideInvalidError(
      'SPECIAL_HOURS requires opening and closing times.',
    );
  try {
    return {
      mode: body.mode,
      opensAtLocalMinute: parseLocalTime(body.opensAt),
      closesAtLocalMinute: parseLocalTime(body.closesAt),
    };
  } catch {
    throw new CommerceOverrideInvalidError(
      'Override times must use HH:mm at minute precision.',
    );
  }
}
