import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { parseQueryInt } from '../../../../common/list/parse-query-int';

export class AnalyticsDateRangeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must use YYYY-MM-DD.' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must use YYYY-MM-DD.' })
  to!: string;
}

export enum AnalyticsTopProductsBasis {
  DELIVERED_QUANTITY = 'DELIVERED_QUANTITY',
  DELIVERED_VALUE = 'DELIVERED_VALUE',
  SHIPPED_QUANTITY = 'SHIPPED_QUANTITY',
}

export class AnalyticsTopProductsQueryDto extends AnalyticsDateRangeQueryDto {
  @IsEnum(AnalyticsTopProductsBasis)
  @IsOptional()
  basis?: AnalyticsTopProductsBasis;

  @Transform(({ value }: { value: unknown }) => parseQueryInt(value))
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
