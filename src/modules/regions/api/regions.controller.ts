import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegionService } from '../application/region.service';
import {
  PublicRegionListResponseDto,
  toPublicRegionDto,
} from './dto/region-response.dto';

@ApiTags('Regions')
@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionService) {}

  @Get()
  @ApiOperation({
    operationId: 'Regions_list',
    summary: 'List active regions',
    description: [
      'Returns the full set of active regions ordered by name ascending.',
      'Inactive regions are never included.',
      'Not paginated: the reference set is expected to stay small for storefront selectors.',
      'No detail route in CAT-02.',
    ].join(' '),
  })
  @ApiOkResponse({
    description: 'Active regions.',
    type: PublicRegionListResponseDto,
  })
  async list(): Promise<PublicRegionListResponseDto> {
    const items = await this.regions.listPublicActive();
    return { data: items.map(toPublicRegionDto) };
  }
}
