import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminMediaDto } from './media-response.dto';

export class MediaUploadItemErrorDto {
  @ApiProperty({ example: 'MEDIA_UNSUPPORTED_TYPE' })
  code!: string;

  @ApiProperty({ example: 'This file type is not supported.' })
  message!: string;
}

export class MediaUploadItemDto {
  @ApiProperty({ example: 0, type: Number })
  index!: number;

  @ApiProperty({ enum: ['uploaded', 'failed'], example: 'uploaded' })
  status!: 'uploaded' | 'failed';

  @ApiPropertyOptional({ type: AdminMediaDto })
  media?: AdminMediaDto;

  @ApiPropertyOptional({ type: MediaUploadItemErrorDto })
  error?: MediaUploadItemErrorDto;
}

export class MediaUploadSummaryDto {
  @ApiProperty({ example: 2, type: Number })
  total!: number;

  @ApiProperty({ example: 1, type: Number })
  uploaded!: number;

  @ApiProperty({ example: 1, type: Number })
  failed!: number;
}

export class MediaUploadBatchDataDto {
  @ApiProperty({ type: MediaUploadItemDto, isArray: true })
  items!: MediaUploadItemDto[];

  @ApiProperty({ type: MediaUploadSummaryDto })
  summary!: MediaUploadSummaryDto;
}

export class MediaUploadBatchResponseDto {
  @ApiProperty({ type: MediaUploadBatchDataDto })
  data!: MediaUploadBatchDataDto;
}
