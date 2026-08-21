import type { Server } from 'node:http';
import { Controller, Get, Query } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import {
  createSortQueryDto,
  PaginationQueryDto,
  parseQueryBoolean,
  resolvePageRequest,
  SearchQueryDto,
  toPaginatedResponse,
} from '../src/common/list';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';

/**
 * Test-only probe for Nest ValidationPipe + query DTO composition.
 * Never registered in production AppModule.
 */
const listProbeSort = createSortQueryDto({
  fields: ['createdAt', 'title'] as const,
  defaultSortBy: 'createdAt',
  defaultSortOrder: 'desc',
});

class ListProbeFilterDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

class ListProbeQueryDto extends IntersectionType(
  PaginationQueryDto,
  SearchQueryDto,
  listProbeSort.SortQueryDto,
  ListProbeFilterDto,
) {}

@Controller('list-probe')
class ListProbeController {
  @Get()
  list(@Query() query: ListProbeQueryDto): {
    data: Array<{ id: string }>;
    meta: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    resolved: {
      search?: string;
      sortBy: string;
      sortOrder: string;
      isActive?: boolean;
    };
  } {
    const pageRequest = resolvePageRequest(query);
    const sort = listProbeSort.resolveSort(query);
    const envelope = toPaginatedResponse([{ id: 'probe-1' }], pageRequest, 1);

    return {
      ...envelope,
      resolved: {
        search: query.search,
        sortBy: sort.sortBy,
        sortOrder: sort.sortOrder,
        isActive: query.isActive,
      },
    };
  }
}

describe('list query primitives (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ListProbeController],
    })
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

  it('applies pagination defaults and resource sort defaults', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/list-probe')
      .expect(200);

    expect(response.body).toMatchObject({
      data: [{ id: 'probe-1' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      resolved: {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
    });
  });

  it('transforms page and pageSize query strings to integers', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/list-probe')
      .query({ page: '2', pageSize: '10', search: '  acme  ', sortBy: 'title' })
      .expect(200);

    expect(response.body).toMatchObject({
      meta: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
      resolved: {
        search: 'acme',
        sortBy: 'title',
        sortOrder: 'desc',
      },
    });
  });

  it('rejects invalid pagination with structured validation errors', async () => {
    for (const query of [
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { pageSize: '101' },
      { sortOrder: 'random' },
      { sortBy: 'notAllowed' },
    ]) {
      const response = await request(app.getHttpServer() as Server)
        .get('/api/v1/list-probe')
        .query(query)
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'BAD_REQUEST',
          message: 'Request validation failed.',
        },
      });
      expect(
        Array.isArray(
          (response.body as { error: { details: { violations: unknown } } })
            .error.details.violations,
        ),
      ).toBe(true);
    }
  });

  it('rejects unknown query parameters', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/list-probe')
      .query({ page: '1', randomInternalThing: '1' })
      .expect(400);

    expect(response.body).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: {
          violations: ['property randomInternalThing should not exist'],
        },
      },
    });
  });

  it('accepts strict boolean filters only', async () => {
    const ok = await request(app.getHttpServer() as Server)
      .get('/api/v1/list-probe')
      .query({ isActive: 'true' })
      .expect(200);

    const okBody = ok.body as {
      resolved: { isActive?: boolean };
    };
    expect(okBody.resolved.isActive).toBe(true);

    await request(app.getHttpServer() as Server)
      .get('/api/v1/list-probe')
      .query({ isActive: 'yes' })
      .expect(400);
  });
});
