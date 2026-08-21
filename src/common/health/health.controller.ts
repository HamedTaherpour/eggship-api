import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({
    operationId: 'Health_get',
    summary: 'Report process liveness',
    description:
      'Returns process liveness and the configured application release version. No authentication is required.',
  })
  @ApiOkResponse({
    description: 'Service is running.',
    type: HealthResponseDto,
  })
  check(): HealthResponseDto {
    return {
      data: {
        status: 'ok',
        version: this.config.getOrThrow<string>('APP_VERSION'),
      },
    };
  }
}
