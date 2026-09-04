import { Matches } from 'class-validator';

export class AnalyticsDateRangeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must use YYYY-MM-DD.' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must use YYYY-MM-DD.' })
  to!: string;
}
