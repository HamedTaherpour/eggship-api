import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { NotificationRecord } from '../../domain/notification';

export class CustomerNotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ORDER_STATUS'] }) type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: NotificationRecord['payload'];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  readAt!: string | null;
}

export const CustomerNotificationListResponseDto = createPaginatedResponseDto(
  CustomerNotificationDto,
  { name: 'CustomerNotificationListResponseDto' },
);

export class NotificationUnreadCountDto {
  @ApiProperty({ type: Number, minimum: 0 }) count!: number;
}

export class NotificationUnreadCountResponseDto {
  @ApiProperty({ type: NotificationUnreadCountDto })
  data!: NotificationUnreadCountDto;
}

export class NotificationReadResponseDto {
  @ApiProperty({ type: CustomerNotificationDto })
  data!: CustomerNotificationDto;
}

export class NotificationMarkAllReadDto {
  @ApiProperty({ type: Number, minimum: 0 }) updatedCount!: number;
}

export class NotificationMarkAllReadResponseDto {
  @ApiProperty({ type: NotificationMarkAllReadDto })
  data!: NotificationMarkAllReadDto;
}

export function toCustomerNotificationDto(
  notification: NotificationRecord,
): CustomerNotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    payload: notification.payload,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
  };
}
