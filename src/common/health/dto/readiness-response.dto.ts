import { ApiProperty } from '@nestjs/swagger';

export class ReadinessChecksDto {
  @ApiProperty({ example: 'ready', enum: ['ready', 'not_ready'] })
  postgres!: 'ready' | 'not_ready';

  @ApiProperty({
    example: 'disabled',
    enum: ['ready', 'not_ready', 'disabled'],
  })
  redis!: 'ready' | 'not_ready' | 'disabled';
}

export class ReadinessDataDto {
  @ApiProperty({ example: 'ready', enum: ['ready', 'not_ready'] })
  status!: 'ready' | 'not_ready';

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

export class ReadinessResponseDto {
  @ApiProperty({ type: ReadinessDataDto })
  data!: ReadinessDataDto;
}
