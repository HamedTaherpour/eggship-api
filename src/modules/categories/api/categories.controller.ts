import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryService } from '../application/category.service';
import {
  PublicCategoryListResponseDto,
  toPublicCategoryDto,
} from './dto/category-response.dto';
import { PublicCategoryListQueryDto } from './dto/public-category-list-query.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @ApiOperation({
    operationId: 'Categories_list',
    summary: 'List active product categories',
    description: [
      'Returns the full set of active categories ordered by name ascending.',
      'Inactive categories are never included.',
      'Not paginated: the reference set is expected to stay small for storefront selectors.',
      'No query parameters are accepted; unknown query parameters are rejected.',
      'No public detail route (list is sufficient until MIG-01 evidences otherwise).',
      'Response fields are limited to id and name (no Admin lifecycle fields).',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Active categories.',
    type: PublicCategoryListResponseDto,
  })
  async list(
    @Query() query: PublicCategoryListQueryDto,
  ): Promise<PublicCategoryListResponseDto> {
    void query;
    const items = await this.categories.listPublicActive();
    return { data: items.map(toPublicCategoryDto) };
  }
}
