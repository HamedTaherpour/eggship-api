import { IntersectionType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/list';

export class NotificationListQueryDto extends IntersectionType(
  PaginationQueryDto,
) {}
