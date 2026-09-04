import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../../common/list';
import { AsyncFailureCategory } from '../../domain/async-recovery';

export class AsyncFailureListQueryDto extends IntersectionType(
  PaginationQueryDto,
) {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;
  @ApiPropertyOptional({ enum: Object.values(AsyncFailureCategory) })
  @IsOptional()
  @IsEnum(AsyncFailureCategory)
  category?: AsyncFailureCategory;
  @ApiPropertyOptional({
    enum: ['RETRY_EXHAUSTED', 'ACKNOWLEDGED', 'DISMISSED'],
  })
  @IsOptional()
  @IsIn(['RETRY_EXHAUSTED', 'ACKNOWLEDGED', 'DISMISSED'])
  lifecycleState?: 'RETRY_EXHAUSTED' | 'ACKNOWLEDGED' | 'DISMISSED';
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  quarantined?: boolean;
}
