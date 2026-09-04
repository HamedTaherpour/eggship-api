import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApplicationLogger } from '../observability/application-logger.service';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ApplicationReadinessService } from './application-readiness.service';
import { HealthResponseDto } from './dto/health-response.dto';
import { ReadinessResponseDto } from './dto/readiness-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly readinessState: ApplicationReadinessService,
    private readonly logger: ApplicationLogger,
  ) {}

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

  @Get('readiness')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Health_readiness',
    summary: 'Report dependency readiness',
    description:
      'Returns whether the API can admit traffic. PostgreSQL is required; Redis is checked only when configured.',
  })
  @ApiOkResponse({
    description: 'Readiness state.',
    type: ReadinessResponseDto,
  })
  async readiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessResponseDto> {
    const postgres = await this.checkPostgres();
    const redis = await this.redis.readiness();
    const checks = {
      postgres: postgres ? ('ready' as const) : ('not_ready' as const),
      redis: !redis.configured
        ? ('disabled' as const)
        : redis.ready
          ? ('ready' as const)
          : ('not_ready' as const),
    };
    const ready =
      this.readinessState.isAcceptingTraffic() &&
      postgres &&
      (!redis.configured || redis.ready);
    if (!postgres) {
      this.logger.warn(
        {
          module: 'health',
          operation: 'readiness_degraded',
          dependency: 'postgres',
        },
        'API readiness check failed',
      );
    }
    if (!ready) response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      data: {
        status: ready ? 'ready' : 'not_ready',
        version: this.config.getOrThrow<string>('APP_VERSION'),
        checks,
      },
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
