import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import {
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { MediaService } from '../application/media.service';

@ApiTags('Media')
@Controller('media')
export class MediaContentController {
  constructor(private readonly media: MediaService) {}

  @Get(':mediaId/content')
  @ApiOperation({
    operationId: 'Media_getContent',
    summary: 'Redirect to public Media content',
  })
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiFoundResponse({ description: 'Short-lived provider redirect.' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async getContent(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Res() response: Response,
  ): Promise<void> {
    const signed = await this.media.createPublicRedirect(mediaId);
    response
      .status(HttpStatus.FOUND)
      .set({
        Location: signed.url,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .end();
  }
}
