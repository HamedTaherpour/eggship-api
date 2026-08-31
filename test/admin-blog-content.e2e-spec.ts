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
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../src/infrastructure/database/transaction';
import { AuditLogService } from '../src/modules/audit/application/audit-log.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import type {
  BlogListQuery,
  BlogRecord,
  CreateBlogInput,
  UpdateBlogInput,
} from '../src/modules/blogs/domain/blog';
import { BlogSlugConflictError } from '../src/modules/blogs/domain/blog-errors';
import {
  applyPublishTransition,
  applyUnpublishTransition,
  isBlogPubliclyVisible,
  resolveBlogPublication,
} from '../src/modules/blogs/domain/blog-publication';
import { validateBlogMarkdown } from '../src/modules/blogs/domain/blog-markdown';
import { normalizeBlogSlug } from '../src/modules/blogs/domain/blog-slug';
import { normalizeBlogTitle } from '../src/modules/blogs/domain/blog-title';
import { BlogRepository } from '../src/modules/blogs/infrastructure/blog.repository';

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

class InMemoryBlogRepository {
  private readonly rows = new Map<string, BlogRecord>();

  clear(): void {
    this.rows.clear();
  }

  seed(record: BlogRecord): void {
    this.rows.set(record.id, record);
  }

  findPublishedBySlug(slug: string): Promise<BlogRecord | null> {
    const canonical = normalizeBlogSlug(slug);
    const found = [...this.rows.values()].find(
      (row) => row.slug === canonical && isBlogPubliclyVisible(row),
    );
    return Promise.resolve(found ?? null);
  }

  findById(id: string): Promise<BlogRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  listPublished(query: BlogListQuery): Promise<{
    items: BlogRecord[];
    total: number;
  }> {
    return this.listWithVisibility(query, true);
  }

  listAll(query: BlogListQuery): Promise<{
    items: BlogRecord[];
    total: number;
  }> {
    return this.listWithVisibility(query, false);
  }

  create(input: CreateBlogInput): Promise<BlogRecord> {
    const slug = normalizeBlogSlug(input.slug);
    if ([...this.rows.values()].some((row) => row.slug === slug)) {
      throw new BlogSlugConflictError();
    }
    const now = new Date();
    const publication = resolveBlogPublication({
      isPublished: input.isPublished ?? false,
      publishedAt: input.publishedAt,
      now,
    });
    const created: BlogRecord = {
      id: randomUUID(),
      slug,
      title: normalizeBlogTitle(input.title),
      body: validateBlogMarkdown(input.body),
      isPublished: publication.isPublished,
      publishedAt: publication.publishedAt,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return Promise.resolve(created);
  }

  update(id: string, input: UpdateBlogInput): Promise<BlogRecord | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const slug =
      input.slug !== undefined ? normalizeBlogSlug(input.slug) : existing.slug;
    if (
      [...this.rows.values()].some((row) => row.id !== id && row.slug === slug)
    ) {
      throw new BlogSlugConflictError();
    }
    const updated: BlogRecord = {
      ...existing,
      slug,
      title:
        input.title !== undefined
          ? normalizeBlogTitle(input.title)
          : existing.title,
      body:
        input.body !== undefined
          ? validateBlogMarkdown(input.body)
          : existing.body,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  publish(
    id: string,
    now: Date,
    _tx?: unknown,
  ): Promise<{ record: BlogRecord; changed: boolean } | null> {
    void _tx;
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    if (existing.isPublished) {
      return Promise.resolve({ record: existing, changed: false });
    }
    const publication = applyPublishTransition(existing, now);
    const updated: BlogRecord = {
      ...existing,
      ...publication,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve({ record: updated, changed: true });
  }

  unpublish(
    id: string,
    _tx?: unknown,
  ): Promise<{ record: BlogRecord; changed: boolean } | null> {
    void _tx;
    const existing = this.rows.get(id);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    if (!existing.isPublished) {
      return Promise.resolve({ record: existing, changed: false });
    }
    const publication = applyUnpublishTransition(existing);
    const updated: BlogRecord = {
      ...existing,
      ...publication,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve({ record: updated, changed: true });
  }

  private listWithVisibility(
    query: BlogListQuery,
    publishedOnly: boolean,
  ): Promise<{
    items: BlogRecord[];
    total: number;
  }> {
    let items = [...this.rows.values()];
    if (publishedOnly) {
      items = items.filter((row) => isBlogPubliclyVisible(row));
    }
    if (query.isPublished !== undefined) {
      items = items.filter((row) => row.isPublished === query.isPublished);
    }
    if (query.search !== undefined) {
      const needle = query.search.toLowerCase();
      items = items.filter((row) => row.title.toLowerCase().includes(needle));
    }
    items.sort((a, b) => {
      const left = a[query.sortBy];
      const right = b[query.sortBy];
      const primary =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : left instanceof Date
            ? 1
            : right instanceof Date
              ? -1
              : String(left ?? '').localeCompare(String(right ?? ''));
      const cmp = primary !== 0 ? primary : a.id.localeCompare(b.id);
      return query.sortOrder === 'asc' ? cmp : -cmp;
    });
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: items.slice(start, start + query.pageSize),
      total,
    });
  }
}

class PassThroughTransactionRunner extends TransactionRunner {
  override run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runIn<T>(
    existing: TransactionContext | undefined,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
  }

  override runSnapshotRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }

  override runRepeatableRead<T>(
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.run(fn);
  }
}

interface ApiErrorBody {
  error: { code: string; message: string };
  requestId: string;
}

interface AdminBlogBody {
  data: {
    id: string;
    slug: string;
    title: string;
    body: string;
    isPublished: boolean;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

interface AdminBlogListBody {
  data: Array<{
    id: string;
    slug: string;
    title: string;
    isPublished: boolean;
    publishedAt: string | null;
  }>;
  meta: { total: number };
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

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

function asAdminBlogBody(body: unknown): AdminBlogBody {
  return body as AdminBlogBody;
}

function asAdminBlogListBody(body: unknown): AdminBlogListBody {
  return body as AdminBlogListBody;
}

describe('Admin blog APIs (e2e)', () => {
  let app: INestApplication;
  let blogs: InMemoryBlogRepository;
  let admins: ConfigurableAdminRoleResolver;

  beforeAll(async () => {
    blogs = new InMemoryBlogRepository();
    admins = new ConfigurableAdminRoleResolver();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: (): void => undefined,
        onModuleDestroy: (): void => undefined,
      })
      .overrideProvider(BlogRepository)
      .useValue(blogs)
      .overrideProvider(TransactionRunner)
      .useValue(new PassThroughTransactionRunner())
      .overrideProvider(AuditLogService)
      .useValue({ append: jest.fn().mockResolvedValue(undefined) })
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
    blogs.clear();
    admins.reset();
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  it('requires auth and CONTENT permissions', async () => {
    await request(server()).get('/api/v1/admin/blogs').expect(401);

    const userToken = signAccessToken(AuthSubjectType.USER);
    await request(server())
      .get('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    admins.activeRole(AdminRole.WAREHOUSE);
    const warehouseToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .expect(403);

    admins.activeRole(AdminRole.SUPER_ADMIN);
    const readToken = signAccessToken(AuthSubjectType.ADMIN);
    await request(server())
      .get('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${readToken}`)
      .expect(200);

    await request(server())
      .post('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${readToken}`)
      .send({
        slug: 'permission-draft',
        title: 'Permission draft',
        body: 'Draft',
      })
      .expect(201);
  });

  it('CONTENT_MANAGE can create, edit, publish, and unpublish with public visibility changes', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const created = await request(server())
      .post('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: '  Packing-Notes  ',
        title: '  Packing notes  ',
        body: '  Cool crate.  ',
      })
      .expect(201);

    const createdBody = asAdminBlogBody(created.body);
    expect(createdBody.data).toMatchObject({
      slug: 'packing-notes',
      title: 'Packing notes',
      body: 'Cool crate.',
      isPublished: false,
      publishedAt: null,
    });

    await request(server())
      .get(`/api/v1/blogs/${createdBody.data.slug}`)
      .expect(404);

    const listed = await request(server())
      .get('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asAdminBlogListBody(listed.body).meta.total).toBe(1);

    const detail = await request(server())
      .get(`/api/v1/admin/blogs/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asAdminBlogBody(detail.body).data.id).toBe(createdBody.data.id);

    const updated = await request(server())
      .patch(`/api/v1/admin/blogs/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title' })
      .expect(200);
    expect(asAdminBlogBody(updated.body).data.title).toBe('Updated title');

    const published = await request(server())
      .post(`/api/v1/admin/blogs/${createdBody.data.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const publishedBody = asAdminBlogBody(published.body);
    expect(publishedBody.data.isPublished).toBe(true);
    expect(publishedBody.data.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await request(server())
      .get(`/api/v1/blogs/${createdBody.data.slug}`)
      .expect(200);

    const replay = await request(server())
      .post(`/api/v1/admin/blogs/${createdBody.data.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asAdminBlogBody(replay.body).data.publishedAt).toBe(
      publishedBody.data.publishedAt,
    );

    const unpublished = await request(server())
      .post(`/api/v1/admin/blogs/${createdBody.data.id}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const unpublishedBody = asAdminBlogBody(unpublished.body);
    expect(unpublishedBody.data.isPublished).toBe(false);
    expect(unpublishedBody.data.publishedAt).toBe(
      publishedBody.data.publishedAt,
    );

    await request(server())
      .get(`/api/v1/blogs/${createdBody.data.slug}`)
      .expect(404);

    await request(server())
      .get(`/api/v1/admin/blogs/${createdBody.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const draftReplay = await request(server())
      .post(`/api/v1/admin/blogs/${createdBody.data.id}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asAdminBlogBody(draftReplay.body).data.publishedAt).toBe(
      publishedBody.data.publishedAt,
    );
  });

  it('returns slug conflict and validation errors', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await request(server())
      .post('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: 'shared-slug',
        title: 'First',
        body: 'One',
      })
      .expect(201);

    const conflict = await request(server())
      .post('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: 'shared-slug',
        title: 'Second',
        body: 'Two',
      })
      .expect(409);
    expect(asApiErrorBody(conflict.body).error.code).toBe('BLOG_SLUG_CONFLICT');

    const invalid = await request(server())
      .post('/api/v1/admin/blogs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: 'valid-slug',
        title: '   ',
        body: 'Body',
      })
      .expect(400);

    expect(asApiErrorBody(invalid.body).error.code).toBe('BAD_REQUEST');

    const unknownQuery = await request(server())
      .get('/api/v1/admin/blogs')
      .query({ unknown: 'x' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(asApiErrorBody(unknownQuery.body).error.code).toBe('BAD_REQUEST');
  });

  it('OpenAPI documents Admin Blog operations', () => {
    const openapi = createOpenApiDocument(app);
    const paths = openapi.paths ?? {};
    expect(paths['/api/v1/admin/blogs']).toBeDefined();
    expect(paths['/api/v1/admin/blogs/{id}']).toBeDefined();
    expect(paths['/api/v1/admin/blogs/{id}/publish']).toBeDefined();
    expect(paths['/api/v1/admin/blogs/{id}/unpublish']).toBeDefined();

    const operations = Object.values(paths).flatMap((pathItem) =>
      Object.values(pathItem ?? {}).filter(
        (op): op is { operationId?: string } =>
          typeof op === 'object' && op !== null,
      ),
    );
    const operationIds = operations
      .map((op) => op.operationId)
      .filter((id): id is string => typeof id === 'string');
    expect(operationIds).toEqual(
      expect.arrayContaining([
        'AdminBlogs_list',
        'AdminBlogs_get',
        'AdminBlogs_create',
        'AdminBlogs_update',
        'AdminBlogs_publish',
        'AdminBlogs_unpublish',
      ]),
    );
  });
});
