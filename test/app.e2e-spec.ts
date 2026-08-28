import type { Server } from 'node:http';
import { PassThrough } from 'node:stream';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { LOG_DESTINATION } from '../src/common/observability/application-logger.service';
import { RequestContextService } from '../src/common/observability/request-context.service';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { bootstrapBrowserCsrf, browserRequest } from './helpers/csrf-browser';

class FoundationInputDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsInt()
  count!: number;
}

@Controller('foundation-audit')
class FoundationAuditController {
  constructor(private readonly context: RequestContextService) {}

  @Post()
  acceptInput(@Body() input: FoundationInputDto): {
    data: FoundationInputDto;
  } {
    return { data: input };
  }

  @Get('internal-error')
  failSafely(): never {
    throw new HttpException(
      'Sensitive database connection detail.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('raw-error')
  failWithUnexpectedError(): never {
    throw new Error('Raw persistence error detail.');
  }

  @Get('context')
  readContext(): {
    data: {
      requestId: string | undefined;
      correlationId: string | undefined;
    };
  } {
    return {
      data: {
        requestId: this.context.getRequestId(),
        correlationId: this.context.getCorrelationId(),
      },
    };
  }
}

describe('application foundation (e2e)', () => {
  let app: INestApplication;
  let logOutput = '';

  beforeAll(async () => {
    const logDestination = new PassThrough();
    logDestination.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString('utf8');
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [FoundationAuditController],
    })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logDestination)
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns the health envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/health')
      .expect(200)
      .expect({ data: { status: 'ok', version: '0.1.0-test' } });

    expect(response.headers['x-request-id']).toMatch(/^req_/u);
  });

  it('keeps ordinary e2e bootstrap isolated from developer Redis and live databases', async () => {
    const config = app.get(ConfigService);
    const redis = app.get(RedisService);

    expect(config.getOrThrow<string>('NODE_ENV')).toBe('test');
    expect(config.getOrThrow<string>('DATABASE_URL')).toBe(
      'postgresql://example.invalid/eggship_test',
    );
    expect(config.get<string>('REDIS_URL')).toBeUndefined();
    expect(redis.isConfigured()).toBe(false);
    await expect(redis.readiness()).resolves.toEqual({
      configured: false,
      ready: false,
    });
  });

  it('makes matching request and correlation IDs available during execution', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/foundation-audit/context')
      .expect(200);
    const requestId = response.headers['x-request-id'];
    const responseBody: unknown = response.body;

    expect(typeof requestId).toBe('string');
    expect(responseBody).toEqual({
      data: { requestId, correlationId: requestId },
    });
  });

  it('does not trust malformed inbound request IDs', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/foundation-audit/context')
      .set('x-request-id', `req_${'x'.repeat(200)}`)
      .expect(200);
    const requestId = response.headers['x-request-id'];

    expect(requestId).toMatch(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(requestId).not.toBe(`req_${'x'.repeat(200)}`);
  });

  it('does not expose routes without the global API prefix', async () => {
    await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(404);
  });

  it('transforms explicitly decorated DTO fields', async () => {
    const csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
    await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/foundation-audit'),
      csrf,
    )
      .send({ name: 'shipment', count: '2' })
      .expect(201)
      .expect({ data: { name: 'shipment', count: 2 } });
  });

  it('rejects non-whitelisted request properties with structured details', async () => {
    const csrf = await bootstrapBrowserCsrf(app.getHttpServer() as Server);
    const response = await browserRequest(
      request(app.getHttpServer() as Server).post('/api/v1/foundation-audit'),
      csrf,
    )
      .set('x-request-id', 'req_validation')
      .send({ name: 'shipment', count: 2, unexpected: true })
      .expect(400);

    const responseBody: unknown = response.body;
    expect(responseBody).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Request validation failed.',
        details: {
          violations: ['property unexpected should not exist'],
        },
      },
      requestId: 'req_validation',
    });
  });

  it('returns structured errors with a request ID', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/missing')
      .set('x-request-id', 'req_test')
      .expect(404);

    const responseBody: unknown = response.body;
    expect(responseBody).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/v1/missing',
        details: {},
      },
      requestId: 'req_test',
    });
  });

  it('uses the generated response request ID in an error body', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/missing-with-generated-id')
      .expect(404);
    const requestId = response.headers['x-request-id'];
    const responseBody: unknown = response.body;

    expect(requestId).toMatch(/^req_/u);
    expect(responseBody).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/v1/missing-with-generated-id',
        details: {},
      },
      requestId,
    });
  });

  it('sanitizes internal HTTP errors without changing their status', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/foundation-audit/internal-error')
      .set('x-request-id', 'req_internal')
      .expect(500)
      .expect('x-request-id', 'req_internal');

    const responseBody: unknown = response.body;
    expect(responseBody).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
      requestId: 'req_internal',
    });
  });

  it('sanitizes unexpected application errors', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/foundation-audit/raw-error')
      .set('x-request-id', 'req_unexpected')
      .expect(500);

    const responseBody: unknown = response.body;
    expect(responseBody).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
      requestId: 'req_unexpected',
    });
  });

  it('isolates context and generates unique IDs across concurrent requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer() as Server)
          .get('/api/v1/foundation-audit/context')
          .expect(200),
      ),
    );
    const requestIds = responses.map(
      (response) => response.headers['x-request-id'],
    );

    expect(requestIds.every((requestId) => typeof requestId === 'string')).toBe(
      true,
    );
    expect(new Set(requestIds).size).toBe(responses.length);
    responses.forEach((response, index) => {
      const responseBody: unknown = response.body;
      const requestId = requestIds[index];
      expect(responseBody).toEqual({
        data: { requestId, correlationId: requestId },
      });
    });
  });

  it('logs one safe structured request completion event', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/health?access_token=query-secret')
      .set('x-request-id', 'req_http_log')
      .expect(200);

    const requestLogs = parseLogRecords(logOutput).filter(
      (record) =>
        record['requestId'] === 'req_http_log' &&
        record['operation'] === 'request',
    );
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({
      level: 'info',
      service: 'eggship-api',
      environment: 'test',
      version: '0.1.0-test',
      gitSha: 'test',
      requestId: 'req_http_log',
      correlationId: 'req_http_log',
      module: 'http',
      operation: 'request',
      method: 'GET',
      path: '/api/v1/health',
      statusCode: 200,
    });
    expect(typeof requestLogs[0]?.['durationMs']).toBe('number');
    expect(logOutput).not.toContain('query-secret');
  });

  it('classifies expected and unexpected failures without duplicate error logs', () => {
    const records = parseLogRecords(logOutput);
    const expected = records.filter(
      (record) =>
        record['requestId'] === 'req_validation' &&
        record['operation'] === 'request_error',
    );
    const unexpected = records.filter(
      (record) =>
        record['requestId'] === 'req_internal' &&
        record['operation'] === 'exception',
    );

    expect(expected).toHaveLength(1);
    expect(expected[0]).toMatchObject({
      level: 'info',
      errorKind: 'expected',
      errorCode: 'BAD_REQUEST',
    });
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]).toMatchObject({
      level: 'error',
      errorKind: 'unexpected',
      errorCode: 'INTERNAL_ERROR',
    });
  });
});

function parseLogRecords(output: string): Array<Record<string, unknown>> {
  return output
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null) {
        throw new Error('Expected a structured JSON log record.');
      }
      return value as Record<string, unknown>;
    });
}
