import {
  Body,
  Controller,
  Get,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
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
import { Permission } from '../../../common/authz/permission';
import { PermissionGuard } from '../../../common/authz/permission.guard';
import { RequirePermissions } from '../../../common/authz/require-permissions.decorator';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AccessTokenGuard } from '../../auth/api/access-token.guard';
import { getAuthenticatedPrincipal } from '../../auth/api/authenticated-principal.util';
import type { Request } from 'express';
import { ProductService } from '../application/product.service';
import { AdminProductListQueryDto } from './dto/admin-product-list-query.dto';
import { CreateProductBodyDto } from './dto/create-product.dto';
import {
  AdminProductListResponseDto,
  AdminProductResponseDto,
  toAdminProductDto,
} from './dto/product-response.dto';
import { UpdateProductBodyDto } from './dto/update-product.dto';

@ApiTags('AdminProducts')
@Controller('admin/products')
@UseGuards(AccessTokenGuard, PermissionGuard)
@ApiCookieAuth('adminAccessCookie')
@ApiBearerAuth('bearer')
export class AdminProductsController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @RequirePermissions(Permission.CATALOG_READ)
  @ApiOperation({
    operationId: 'AdminProducts_list',
    summary: 'List products (Admin)',
    description: [
      'Paginated Admin list with optional `search` (name), `sortBy`/`sortOrder` (`name`, `price`, `createdAt`, `updatedAt`; default `createdAt`/`desc`), `categoryId`, and `isActive`.',
      'Unknown query parameters are rejected.',
      'Requires CATALOG_READ. Price is integer Toman.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated products.',
    type: AdminProductListResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async list(
    @Query() query: AdminProductListQueryDto,
  ): Promise<InstanceType<typeof AdminProductListResponseDto>> {
    const page = await this.products.listAdmin(query);
    return {
      data: page.data.map(toAdminProductDto),
      meta: page.meta,
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.CATALOG_READ)
  @ApiOperation({
    operationId: 'AdminProducts_get',
    summary: 'Get a product by id (Admin)',
    description: [
      'Returns any product including inactive. Requires CATALOG_READ.',
      'Returns PRODUCT_NOT_FOUND when the id does not exist.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Admin product.',
    type: AdminProductResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminProductResponseDto> {
    const product = await this.products.getAdminById(id);
    return { data: toAdminProductDto(product) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminProducts_create',
    summary: 'Create a product (Admin)',
    description: [
      'Creates a product with trimmed name, integer Toman price, and Category FK.',
      'Category must exist; inactive categories may be assigned.',
      'No hard-delete endpoint: deactivate via PATCH.',
      'No inventory quantities on Product (INV-01). Media deferred to CAT-04.',
      'Requires CATALOG_MANAGE. Admin mutations are auditable candidates once AUD-01 exists.',
      'Price changes write immutable PriceHistory rows atomically with Product.price (PRC-01). Orders must snapshot price/title (ORD-01).',
    ].join(' '),
  })
  @ApiBody({ type: CreateProductBodyDto })
  @ApiCreatedResponse({
    description: 'Created product.',
    type: AdminProductResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async create(
    @Body() body: CreateProductBodyDto,
  ): Promise<AdminProductResponseDto> {
    const created = await this.products.create(body);
    return { data: toAdminProductDto(created) };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.CATALOG_MANAGE)
  @ApiOperation({
    operationId: 'AdminProducts_update',
    summary: 'Update a product (Admin)',
    description: [
      'Updates allowlisted fields only: name, price, categoryId, isActive.',
      'Unknown body properties are rejected. Mass assignment of id/timestamps/inventory is impossible.',
      'Requires CATALOG_MANAGE.',
      'Returns PRODUCT_NOT_FOUND when the id does not exist.',
      'Returns PRODUCT_INVALID_CATEGORY when categoryId does not exist.',
      'Returns PRODUCT_INVALID_PRICE for non-positive or non-integer prices.',
      'Price changes require an authenticated Admin actor and append immutable PriceHistory (PRC-01).',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateProductBodyDto })
  @ApiOkResponse({
    description: 'Updated product.',
    type: AdminProductResponseDto,
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductBodyDto,
    @Req() request: Request,
  ): Promise<AdminProductResponseDto> {
    const principal = getAuthenticatedPrincipal(request);
    const updated = await this.products.update(id, body, principal!);
    return { data: toAdminProductDto(updated) };
  }
}
