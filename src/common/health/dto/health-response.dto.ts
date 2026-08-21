import { ApiProperty } from '@nestjs/swagger';

export class HealthDataDto {
  @ApiProperty({
    enum: ['ok'],
    example: 'ok',
    description: 'Process liveness indicator.',
  })
  status!: 'ok';

  @ApiProperty({
    example: '0.1.0',
    description: 'Configured application release version (APP_VERSION).',
  })
  version!: string;
}

export class HealthResponseDto {
  @ApiProperty({ type: HealthDataDto })
  data!: HealthDataDto;
}
