import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../src/common/authz/admin-role-resolver';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { InMemoryStorageProvider } from '../src/infrastructure/storage/in-memory-storage.provider';
import { STORAGE_PROVIDER } from '../src/infrastructure/storage/storage.tokens';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import type {
  CreateMediaInput,
  MediaListQuery,
  MediaRecord,
} from '../src/modules/media/domain/media';
import {
  jpegFixture,
  pngFixture,
  svgFixture,
  gifFixture,
} from '../src/modules/media/domain/media-test-fixtures';
import { HARD_MEDIA_MAX_FILES_PER_BATCH } from '../src/modules/media/domain/media-upload-limits';
import { MediaRepository } from '../src/modules/media/infrastructure/media.repository';

class ConfigurableAdminRoleResolver implements AdminRoleResolver {
  private lookup: AdminAuthorizationLookup = { status: 'unavailable' };

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    if (this.lookup.status === 'found') {
      return Promise.resolve({
        status: 'found',
        record: { ...this.lookup.record, adminId },
      });
    }
    return Promise.resolve(this.lookup);
  }

  activeRole(role: string): void {
    this.lookup = {
      status: 'found',
      record: { adminId: 'replaced', role, isActive: true },
    };
  }

  reset(): void {
    this.lookup = { status: 'unavailable' };
  }
}

class InMemoryMediaRepository {
  private readonly rows = new Map<string, MediaRecord>();

  clear(): void {
    this.rows.clear();
  }

  seed(record: MediaRecord): void {
    this.rows.set(record.id, record);
  }

  findById(id: string): Promise<MediaRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  isReferencedBySettlement(): Promise<boolean> {
    return Promise.resolve(false);
  }

  list(
    query: MediaListQuery,
  ): Promise<{ items: MediaRecord[]; total: number }> {
    let items = [...this.rows.values()];
    if (query.mimeType !== undefined) {
      items = items.filter((row) => row.mimeType === query.mimeType);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) =>
        row.originalFileName.toLowerCase().includes(needle),
      );
    }
    if (query.createdFrom !== undefined) {
      items = items.filter((row) => row.createdAt >= query.createdFrom!);
    }
    if (query.createdTo !== undefined) {
      items = items.filter((row) => row.createdAt <= query.createdTo!);
    }
    items.sort((a, b) => {
      const left = a[query.sortBy];
      const right = b[query.sortBy];
      const cmp =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right));
      return query.sortOrder === 'asc' ? cmp : -cmp;
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }

  create(input: CreateMediaInput): Promise<MediaRecord> {
    const now = new Date();
    const created: MediaRecord = {
      id: randomUUID(),
      storageKey: input.storageKey,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  deleteById(id: string): Promise<MediaRecord | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    this.rows.delete(id);
    return Promise.resolve(existing);
  }
}

function signAccessToken(subjectType: AuthSubjectType): string {
  return jwt.sign(
    {
      sub: randomUUID(),
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
  requestId: string;
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

describe('Admin Media Library APIs (e2e)', () => {
  let app: INestApplication;
  let media: InMemoryMediaRepository;
  let storage: InMemoryStorageProvider;
  let admins: ConfigurableAdminRoleResolver;

  beforeAll(async () => {
    media = new InMemoryMediaRepository();
    storage = new InMemoryStorageProvider('https://media.test.invalid');
    admins = new ConfigurableAdminRoleResolver();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(MediaRepository)
      .useValue(media)
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(storage)
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(admins)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    media.clear();
    storage.clearForTest();
    admins.reset();
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function adminToken(role: string = AdminRole.SUPER_ADMIN): string {
    admins.activeRole(role);
    return signAccessToken(AuthSubjectType.ADMIN);
  }

  it('rejects unauthenticated, USER, and insufficient Admin permission', async () => {
    await request(server()).post('/api/v1/admin/media/upload').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    const userDenied = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('files', jpegFixture(), 'photo.jpg')
      .expect(403);
    expect(asApiErrorBody(userDenied.body).error.code).toBe('AUTH_FORBIDDEN');
    expect(userDenied.headers['x-request-id']).toBeDefined();

    const warehouse = adminToken(AdminRole.WAREHOUSE);
    await request(server())
      .get('/api/v1/admin/media')
      .set('Authorization', `Bearer ${warehouse}`)
      .expect(200);

    await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${warehouse}`)
      .attach('files', jpegFixture(), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(403);

    const orderOps = adminToken(AdminRole.ORDER_OPS);
    await request(server())
      .get('/api/v1/admin/media')
      .set('Authorization', `Bearer ${orderOps}`)
      .expect(403);
  });

  it('uploads a single file and returns derived url without storageKey', async () => {
    const token = adminToken();
    const response = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpegFixture(), {
        filename: 'cage-free.jpg',
        contentType: 'image/jpeg',
      })
      .expect(200);

    const body = response.body as {
      data: {
        items: Array<{
          index: number;
          status: string;
          media?: Record<string, unknown>;
        }>;
        summary: { total: number; uploaded: number; failed: number };
      };
    };
    expect(body.data.summary).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(body.data.items[0]?.status).toBe('uploaded');
    expect(body.data.items[0]?.media).toMatchObject({
      originalFileName: 'cage-free.jpg',
      mimeType: 'image/jpeg',
    });
    expect(body.data.items[0]?.media).not.toHaveProperty('storageKey');
    expect(String(body.data.items[0]?.media?.['url'])).toContain(
      'https://media.test.invalid/media/',
    );
    expect(JSON.stringify(body)).not.toContain('STORAGE_SECRET');
    expect(storage.countForTest()).toBe(1);
  });

  it('returns HTTP 200 with mixed per-file results', async () => {
    const token = adminToken();
    const response = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpegFixture(), {
        filename: 'ok.jpg',
        contentType: 'image/jpeg',
      })
      .attach('files', svgFixture(), {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      })
      .expect(200);

    const body = response.body as {
      data: {
        items: Array<{ status: string; error?: { code: string } }>;
        summary: { uploaded: number; failed: number };
      };
    };
    expect(body.data.summary).toEqual({ total: 2, uploaded: 1, failed: 1 });
    expect(body.data.items.map((item) => item.status).sort()).toEqual([
      'failed',
      'uploaded',
    ]);
    expect(
      body.data.items.find((item) => item.status === 'failed')?.error?.code,
    ).toBe('MEDIA_UNSUPPORTED_TYPE');
    expect(storage.countForTest()).toBe(1);
  });

  it('rejects spoofed PNG content-type for JPEG bytes', async () => {
    const token = adminToken();
    const response = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', jpegFixture(), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(200);
    const body = response.body as {
      data: {
        items: Array<{ error?: { code: string } }>;
        summary: { failed: number };
      };
    };
    expect(body.data.summary.failed).toBe(1);
    expect(body.data.items[0]?.error?.code).toBe('MEDIA_UNSUPPORTED_TYPE');
  });

  it('rejects too many files at the request level', async () => {
    const token = adminToken();
    const req = request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`);
    for (let i = 0; i < 11; i += 1) {
      req.attach('files', jpegFixture(), {
        filename: `n${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    const response = await req.expect(400);
    expect(asApiErrorBody(response.body).error.code).toBe(
      'MEDIA_TOO_MANY_FILES',
    );
  });

  it('rejects multer hard file-count without leaking field names', async () => {
    const token = adminToken();
    const req = request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`);
    for (let i = 0; i < HARD_MEDIA_MAX_FILES_PER_BATCH + 1; i += 1) {
      req.attach('files', jpegFixture(), {
        filename: `hard-${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    const tooMany = await req.expect(400);
    expect(asApiErrorBody(tooMany.body).error.code).toBe(
      'MEDIA_TOO_MANY_FILES',
    );

    const wrongField = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', jpegFixture(), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    const wrongBody = asApiErrorBody(wrongField.body);
    expect(wrongBody.error.code).toBe('MEDIA_TOO_MANY_FILES');
    expect(JSON.stringify(wrongField.body)).not.toContain('Unexpected field');
  });

  it('rejects GIF as an unsupported type', async () => {
    const token = adminToken();
    const response = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', gifFixture(), {
        filename: 'anim.gif',
        contentType: 'image/gif',
      })
      .expect(200);
    const body = response.body as {
      data: {
        items: Array<{ error?: { code: string } }>;
        summary: { uploaded: number; failed: number };
      };
    };
    expect(body.data.summary).toEqual({
      total: 1,
      uploaded: 0,
      failed: 1,
    });
    expect(body.data.items[0]?.error?.code).toBe('MEDIA_UNSUPPORTED_TYPE');
  });

  it('lists, searches, sorts, and details media without leaking storageKey', async () => {
    const token = adminToken();
    const older: MediaRecord = {
      id: randomUUID(),
      storageKey: 'media/2026/08/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      originalFileName: 'alpha-eggs.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      width: 1,
      height: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const newer: MediaRecord = {
      id: randomUUID(),
      storageKey: 'media/2026/08/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png',
      originalFileName: 'beta-banner.png',
      mimeType: 'image/png',
      sizeBytes: 20,
      width: 1,
      height: 1,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    media.seed(older);
    media.seed(newer);

    const listed = await request(server())
      .get('/api/v1/admin/media')
      .query({
        page: 1,
        pageSize: 10,
        search: 'eggs',
        sortBy: 'originalFileName',
        sortOrder: 'asc',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listBody = listed.body as {
      data: Array<{ originalFileName: string }>;
      meta: { total: number };
    };
    expect(listBody.meta.total).toBe(1);
    expect(listBody.data[0]?.originalFileName).toBe('alpha-eggs.jpg');
    expect(JSON.stringify(listed.body)).not.toContain('storageKey');

    const detail = await request(server())
      .get(`/api/v1/admin/media/${newer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detail.body as { data: { mimeType: string } }).data.mimeType).toBe(
      'image/png',
    );

    const rejected = await request(server())
      .get('/api/v1/admin/media')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(rejected.body).error.code).toBe('BAD_REQUEST');

    const jpegOnly = await request(server())
      .get('/api/v1/admin/media')
      .query({ mimeType: 'image/jpeg', sortBy: 'createdAt' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const jpegBody = jpegOnly.body as {
      data: Array<{ mimeType: string }>;
      meta: { total: number };
    };
    expect(jpegBody.meta.total).toBe(1);
    expect(jpegBody.data[0]?.mimeType).toBe('image/jpeg');

    const badMime = await request(server())
      .get('/api/v1/admin/media')
      .query({ mimeType: 'image/gif' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(badMime.body).error.code).toBe('BAD_REQUEST');
  });

  it('deletes media metadata and the stored object', async () => {
    const token = adminToken();
    const uploaded = await request(server())
      .post('/api/v1/admin/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', pngFixture(), {
        filename: 'banner.png',
        contentType: 'image/png',
      })
      .expect(200);
    const id = (
      uploaded.body as { data: { items: Array<{ media?: { id: string } }> } }
    ).data.items[0]?.media?.id;
    expect(id).toBeDefined();
    expect(storage.countForTest()).toBe(1);

    await request(server())
      .delete(`/api/v1/admin/media/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(storage.countForTest()).toBe(0);

    await request(server())
      .get(`/api/v1/admin/media/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('documents Admin Media operations in OpenAPI', () => {
    const openapi = createOpenApiDocument(app);
    const paths = openapi.paths ?? {};
    expect(paths['/api/v1/admin/media']).toBeDefined();
    expect(paths['/api/v1/admin/media/upload']).toBeDefined();
    expect(paths['/api/v1/admin/media/{id}']).toBeDefined();
    const upload = paths['/api/v1/admin/media/upload']?.post;
    expect(upload?.operationId).toBe('AdminMedia_upload');
    expect(JSON.stringify(openapi)).not.toContain('STORAGE_ACCESS_KEY');
    expect(JSON.stringify(openapi)).not.toContain('liara.ir');
  });
});
