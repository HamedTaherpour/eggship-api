import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requireCustomerOwnerId } from '../../../common/authz/resource-ownership';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { PushInstallationService } from '../application/push-installation.service';
import {
  RegisterPushInstallationDto,
  PushInstallationResponseEnvelopeDto,
} from './dto/push-installation.dto';

const PUSH_INSTALLATION_CACHE_CONTROL = 'no-store';

@ApiTags('Notifications')
@Controller('notifications/installations')
@UseGuards(AccessTokenGuard)
@ApiCookieAuth('accessCookie')
@ApiBearerAuth('bearer')
export class PushInstallationController {
  constructor(private readonly service: PushInstallationService) {}

  @Put(':installationId')
  @Header('Cache-Control', PUSH_INSTALLATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_registerInstallation',
    summary: 'Register or reactivate an owned push installation',
    description:
      'Idempotent registration. The provider token is accepted only as write input and is never returned, logged, or included in an error.',
  })
  @ApiParam({ name: 'installationId', format: 'uuid' })
  @ApiOkResponse({ type: PushInstallationResponseEnvelopeDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async register(
    @Req() request: Request,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() body: RegisterPushInstallationDto,
  ): Promise<PushInstallationResponseEnvelopeDto> {
    const row = await this.service.register(
      requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
      {
        installationId,
        providerToken: body.providerToken,
        permissionGranted: body.permissionGranted,
        channel: body.channel,
        os: body.os,
      },
    );
    return {
      data: {
        id: row.id,
        installationId: row.installationId,
        status: row.status,
        permissionGranted: row.permissionGranted,
        channel: row.channel,
        os: row.os,
      },
    };
  }

  @Delete(':installationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', PUSH_INSTALLATION_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'Notifications_revokeInstallation',
    summary: 'Revoke an owned push installation',
    description:
      'Idempotent owner-scoped revocation. Browser cookie mutations require the shared CSRF contract.',
  })
  @ApiParam({ name: 'installationId', format: 'uuid' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async revoke(
    @Req() request: Request,
    @Param('installationId', ParseUUIDPipe) installationId: string,
  ): Promise<void> {
    await this.service.revoke(
      requireCustomerOwnerId(getAuthenticatedPrincipal(request)),
      installationId,
    );
  }
}
