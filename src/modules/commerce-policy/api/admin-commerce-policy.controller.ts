import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import { CommercePolicyService } from '../application/commerce-policy.service';
import {
  CommercePolicyNotInitializedError,
  CommerceOverrideInvalidError,
} from '../domain/commerce-policy-errors';
import {
  CommerceOverrideBodyDto,
  CommerceOverrideRangeQueryDto,
  CommerceSettingsBodyDto,
  RemoveCommerceOverrideBodyDto,
  toOverrideInput,
  toSettingsInput,
} from './dto/commerce-policy-request.dto';
import {
  CommerceOverrideListResponseDto,
  CommerceOverrideMutationResponseDto,
  CommerceSettingsResponseDto,
  toOverrideDto,
  toSettingsDto,
} from './dto/commerce-policy-response.dto';

@ApiTags('AdminCommercePolicy')
@Controller('admin/commerce-policy')
@UseGuards(AccessTokenGuard, PermissionGuard)
@RequirePermissions(Permission.COMMERCE_POLICY_MANAGE)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminCommercePolicyController {
  constructor(private readonly service: CommercePolicyService) {}

  @Get()
  @ApiOperation({
    operationId: 'AdminCommercePolicy_get',
    summary: 'Get commerce settings (Admin)',
    description:
      'Returns null until explicitly initialized. Requires COMMERCE_POLICY_MANAGE.',
  })
  @ApiOkResponse({ type: CommerceSettingsResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async get(): Promise<CommerceSettingsResponseDto> {
    const value = await this.service.getSettings();
    return { data: value === null ? null : toSettingsDto(value) };
  }

  @Post('initialize')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'AdminCommercePolicy_initialize',
    summary: 'Initialize commerce settings (Admin)',
    description:
      'Requires expectedRevision=0. The single winner creates revision 1; concurrent/stale attempts return COMMERCE_POLICY_REVISION_CONFLICT.',
  })
  @ApiBody({ type: CommerceSettingsBodyDto })
  @ApiCreatedResponse({ type: CommerceSettingsResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async initialize(
    @Body() body: CommerceSettingsBodyDto,
    @Req() request: Request,
  ): Promise<CommerceSettingsResponseDto> {
    const value = await this.service.initialize(
      toSettingsInput(body),
      body.expectedRevision,
      actorId(request),
    );
    return { data: toSettingsDto(value) };
  }

  @Put('settings')
  @ApiOperation({
    operationId: 'AdminCommercePolicy_updateSettings',
    summary: 'Replace regular commerce settings (Admin)',
    description:
      'Full typed replacement. Requires the current expectedRevision; each effective change increments the global revision exactly once. Cross-midnight is supported; equal times are rejected.',
  })
  @ApiBody({ type: CommerceSettingsBodyDto })
  @ApiOkResponse({ type: CommerceSettingsResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async update(
    @Body() body: CommerceSettingsBodyDto,
    @Req() request: Request,
  ): Promise<CommerceSettingsResponseDto> {
    const result = await this.service.update(
      toSettingsInput(body),
      body.expectedRevision,
      actorId(request),
    );
    return { data: toSettingsDto(result.settings) };
  }

  @Get('overrides')
  @ApiOperation({
    operationId: 'AdminCommercePolicy_listOverrides',
    summary: 'List commerce schedule overrides (Admin)',
    description:
      'Bounded inclusive Tehran-local date range, at most 366 days. Returns the current global revision for subsequent optimistic writes.',
  })
  @ApiOkResponse({ type: CommerceOverrideListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async listOverrides(
    @Query() query: CommerceOverrideRangeQueryDto,
  ): Promise<CommerceOverrideListResponseDto> {
    const settings = await this.service.getSettings();
    if (settings === null) throw new CommercePolicyNotInitializedError();
    const overrides = await this.service.listOverrides(query.from, query.to);
    return {
      data: {
        revision: settings.revision,
        overrides: overrides.map(toOverrideDto),
      },
    };
  }

  @Put('overrides/:localDate')
  @ApiOperation({
    operationId: 'AdminCommercePolicy_putOverride',
    summary: 'Create or replace a date override (Admin)',
    description:
      'CLOSED forbids hours; SPECIAL_HOURS requires distinct HH:mm hours. Requires current expectedRevision and increments the global revision once for an effective change.',
  })
  @ApiParam({
    name: 'localDate',
    schema: { type: 'string', format: 'date' },
    example: '2026-08-25',
  })
  @ApiBody({ type: CommerceOverrideBodyDto })
  @ApiOkResponse({ type: CommerceOverrideMutationResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async putOverride(
    @Param('localDate') localDate: string,
    @Body() body: CommerceOverrideBodyDto,
    @Req() request: Request,
  ): Promise<CommerceOverrideMutationResponseDto> {
    if (localDate.includes('/')) throw new CommerceOverrideInvalidError();
    const result = await this.service.putOverride(
      localDate,
      toOverrideInput(body),
      body.expectedRevision,
      actorId(request),
    );
    return {
      data: {
        revision: result.settings.revision,
        override: toOverrideDto(result.override),
      },
    };
  }

  @Delete('overrides/:localDate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'AdminCommercePolicy_removeOverride',
    summary: 'Remove a date override (Admin)',
    description:
      'Hard-deletes the override so evaluation falls back naturally. Requires current expectedRevision and increments the global revision once.',
  })
  @ApiParam({ name: 'localDate', schema: { type: 'string', format: 'date' } })
  @ApiBody({ type: RemoveCommerceOverrideBodyDto })
  @ApiOkResponse({ type: CommerceSettingsResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async removeOverride(
    @Param('localDate') localDate: string,
    @Body() body: RemoveCommerceOverrideBodyDto,
    @Req() request: Request,
  ): Promise<CommerceSettingsResponseDto> {
    const result = await this.service.removeOverride(
      localDate,
      body.expectedRevision,
      actorId(request),
    );
    return { data: toSettingsDto(result.settings) };
  }
}

function actorId(request: Request): string {
  return getAuthenticatedPrincipal(request)!.subjectId;
}
