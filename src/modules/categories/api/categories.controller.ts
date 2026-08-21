import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryService } from '../application/category.service';
import {
  PublicCategoryListResponseDto,
  toPublicCategoryDto,
} from './dto/category-response.dto';

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
      'No detail route in CAT-02 (storefront list is sufficient until evidenced otherwise).',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Active categories.',
    type: PublicCategoryListResponseDto,
  })
  async list(): Promise<PublicCategoryListResponseDto> {
    const items = await this.categories.listPublicActive();
    return { data: items.map(toPublicCategoryDto) };
  }
}
