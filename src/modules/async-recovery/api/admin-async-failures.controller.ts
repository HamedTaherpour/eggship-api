import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { AsyncRecoveryService } from '../application/async-recovery.service';
import { AsyncFailureListQueryDto } from './dto/async-failure-list-query.dto';
import {
  AsyncFailureListResponseDto,
  AsyncFailureResponseDto,
} from './dto/async-failure-response.dto';

@ApiTags('AdminAsyncFailures')
@Controller('admin/async-failures')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminAsyncFailuresController {
  constructor(private readonly recovery: AsyncRecoveryService) {}

  @Get()
  @RequirePermissions(Permission.ASYNC_FAILURE_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAsyncFailures_list',
    summary: 'List normalized async failures',
  })
  @ApiOkResponse({ type: AsyncFailureListResponseDto })
  async list(
    @Req() _request: Request,
    @Query() query: AsyncFailureListQueryDto,
  ): Promise<AsyncFailureListResponseDto> {
    const result = await this.recovery.list(query);
    return result;
  }

  @Get(':id')
  @RequirePermissions(Permission.ASYNC_FAILURE_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAsyncFailures_get',
    summary: 'Get async failure and replay history',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AsyncFailureResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AsyncFailureResponseDto> {
    return { data: await this.recovery.get(id) };
  }

  @Post(':id/replays')
  @RequirePermissions(Permission.ASYNC_FAILURE_REPLAY)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'AdminAsyncFailures_replay',
    summary: 'Request an approved deterministic replay',
  })
  async replay(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AsyncFailureResponseDto> {
    const principal = getAuthenticatedPrincipal(request);
    return { data: await this.recovery.replay(id, principal?.subjectId ?? '') };
  }

  @Post(':id/acknowledge')
  @RequirePermissions(Permission.ASYNC_FAILURE_MANAGE)
  async acknowledge(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return this.mutate(request, id, 'acknowledge');
  }
  @Post(':id/quarantine')
  @RequirePermissions(Permission.ASYNC_FAILURE_MANAGE)
  async quarantine(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return this.mutate(request, id, 'quarantine');
  }
  @Post(':id/unquarantine')
  @RequirePermissions(Permission.ASYNC_FAILURE_MANAGE)
  async unquarantine(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return this.mutate(request, id, 'unquarantine');
  }
  @Post(':id/dismiss')
  @RequirePermissions(Permission.ASYNC_FAILURE_MANAGE)
  async dismiss(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return this.mutate(request, id, 'dismiss');
  }

  private mutate(
    request: Request,
    id: string,
    action: 'acknowledge' | 'quarantine' | 'unquarantine' | 'dismiss',
  ): Promise<{ data: unknown }> {
    const principal = getAuthenticatedPrincipal(request);
    return this.recovery
      .mutate(id, action, principal?.subjectId ?? '')
      .then((data) => ({ data }));
  }
}
