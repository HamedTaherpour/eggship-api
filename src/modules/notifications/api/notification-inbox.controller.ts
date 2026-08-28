import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requireCustomerOwnerId } from '../../../common/authz/resource-ownership';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { NotificationInboxService } from '../application/notification-inbox.service';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import {
  CustomerNotificationListResponseDto,
  NotificationMarkAllReadResponseDto,
  NotificationReadResponseDto,
  NotificationUnreadCountResponseDto,
  toCustomerNotificationDto,
} from './dto/notification-response.dto';

const NOTIFICATION_CACHE_CONTROL = 'no-store';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AccessTokenGuard)
@ApiCookieAuth('accessCookie')
@ApiBearerAuth('bearer')
export class NotificationInboxController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @Header('Cache-Control', NOTIFICATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_list',
    summary: 'List own customer notifications',
    description:
      'Authenticated USER subjects only. Supports bounded page/pageSize pagination, newest-first with stable id tie-break. Unknown query parameters are rejected. Returns Cache-Control: no-store.',
  })
  @ApiOkResponse({ type: CustomerNotificationListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Req() request: Request,
    @Query() query: NotificationListQueryDto,
  ): Promise<InstanceType<typeof CustomerNotificationListResponseDto>> {
    const page = await this.inbox.listOwned(
      requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
      query,
    );
    return { data: page.data.map(toCustomerNotificationDto), meta: page.meta };
  }

  @Get('unread-count')
  @Header('Cache-Control', NOTIFICATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_unreadCount',
    summary: 'Count own unread customer notifications',
    description:
      'Authenticated USER subjects only. Count is derived from PostgreSQL and responses are never cached.',
  })
  @ApiOkResponse({ type: NotificationUnreadCountResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async unreadCount(
    @Req() request: Request,
  ): Promise<NotificationUnreadCountResponseDto> {
    return {
      data: {
        count: await this.inbox.countUnread(
          requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
        ),
      },
    };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NOTIFICATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_markRead',
    summary: 'Mark one own notification as read',
    description:
      'Owner-scoped and idempotent. Replaying an already-read notification preserves its original readAt. Missing and other-owner notifications return the same NOTIFICATION_NOT_FOUND response. Browser cookie mutations remain protected by global CSRF enforcement.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationReadResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async markRead(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationReadResponseDto> {
    const value = await this.inbox.markRead(
      requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
      id,
    );
    return { data: toCustomerNotificationDto(value) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NOTIFICATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_markAllRead',
    summary: 'Mark all own notifications as read',
    description:
      'Owner-scoped, idempotent bulk update. Already-read notifications are not rewritten. Browser cookie mutations remain protected by global CSRF enforcement.',
  })
  @ApiOkResponse({ type: NotificationMarkAllReadResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async markAllRead(
    @Req() request: Request,
  ): Promise<NotificationMarkAllReadResponseDto> {
    return {
      data: {
        updatedCount: await this.inbox.markAllRead(
          requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
        ),
      },
    };
  }
}
