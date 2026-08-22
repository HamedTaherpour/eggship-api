import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { ProductService } from '../application/product.service';
import { PublicProductListQueryDto } from './dto/public-product-list-query.dto';
import {
  PublicProductListResponseDto,
  PublicProductResponseDto,
  toPublicProductDto,
} from './dto/product-response.dto';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @ApiOperation({
    operationId: 'Products_list',
    summary: 'List public products',
    description: [
      'Paginated storefront list of active products whose Category is also active.',
      'Supports `page`, `pageSize`, `search` (name only), `sortBy`/`sortOrder` allowlist (`name`, `price`, `createdAt`, `updatedAt`; default `name`/`asc`), and optional `categoryId` filter.',
      'Inactive products and products under inactive categories are never included.',
      '`isActive` is not a public filter. Unknown query parameters are rejected.',
      'Response fields are limited to id, name, price (integer Toman), and categoryId.',
      'No inventory quantities, Admin lifecycle fields, or nested Category hydration (N+1-safe).',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Paginated public products.',
    type: PublicProductListResponseDto,
  })
  async list(
    @Query() query: PublicProductListQueryDto,
  ): Promise<InstanceType<typeof PublicProductListResponseDto>> {
    const page = await this.products.listPublic(query);
    return {
      data: page.data.map(toPublicProductDto),
      meta: page.meta,
    };
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'Products_get',
    summary: 'Get a public product by id',
    description: [
      'Returns an active product whose Category is also active.',
      'Inactive products, missing ids, and products under inactive categories return PRODUCT_NOT_FOUND (no existence leak).',
      'Response fields are limited to id, name, price (integer Toman), and categoryId.',
      'No inventory quantities or Admin lifecycle fields are exposed.',
    ].join(' '),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Public product.',
    type: PublicProductResponseDto,
  })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicProductResponseDto> {
    const product = await this.products.getPublicById(id);
    return { data: toPublicProductDto(product) };
  }
}
