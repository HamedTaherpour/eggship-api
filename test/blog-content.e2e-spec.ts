import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { createOpenApiDocument } from '../src/common/openapi/openapi.document';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import type {
  BlogListQuery,
  BlogRecord,
} from '../src/modules/blogs/domain/blog';
import { isBlogPubliclyVisible } from '../src/modules/blogs/domain/blog-publication';
import { normalizeBlogSlug } from '../src/modules/blogs/domain/blog-slug';
import { BlogRepository } from '../src/modules/blogs/infrastructure/blog.repository';

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

interface ApiErrorBody {
  error: { code: string; message: string };
  requestId: string;
}

interface PublicBlogListBody {
  data: Array<{
    id: string;
    slug: string;
    title: string;
    publishedAt: string;
  }>;
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface PublicBlogBody {
  data: {
    id: string;
    slug: string;
    title: string;
    body: string;
    publishedAt: string;
  };
}

function asApiErrorBody(body: unknown): ApiErrorBody {
  return body as ApiErrorBody;
}

function asPublicBlogListBody(body: unknown): PublicBlogListBody {
  return body as PublicBlogListBody;
}

function asPublicBlogBody(body: unknown): PublicBlogBody {
  return body as PublicBlogBody;
}

describe('Public blog APIs (e2e)', () => {
  let app: INestApplication;
  let blogs: InMemoryBlogRepository;

  beforeAll(async () => {
    blogs = new InMemoryBlogRepository();

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
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function seedBlog(overrides: Partial<BlogRecord> = {}): BlogRecord {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const record: BlogRecord = {
      id: overrides.id ?? randomUUID(),
      slug: overrides.slug ?? `post-${randomUUID().slice(0, 8)}`,
      title: overrides.title ?? 'Published post',
      body: overrides.body ?? '<p>Published body</p>',
      isPublished: overrides.isPublished ?? true,
      publishedAt:
        overrides.publishedAt === undefined ? now : overrides.publishedAt,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };
    blogs.seed(record);
    return record;
  }

  it('lists published posts, hides drafts from items and totals, and searches title only', async () => {
    const older = seedBlog({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      slug: 'older-post',
      title: 'Older packing notes',
      publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const newer = seedBlog({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'newer-post',
      title: 'Newer packing notes',
      publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    seedBlog({
      slug: 'secret-draft',
      title: 'Draft packing notes',
      body: '<p>Draft only</p>',
      isPublished: false,
      publishedAt: null,
    });

    const listed = asPublicBlogListBody(
      (await request(server()).get('/api/v1/blogs').expect(200)).body,
    );
    expect(listed.meta.total).toBe(2);
    expect(listed.data.map((row) => row.slug)).toEqual([
      newer.slug,
      older.slug,
    ]);
    expect(listed.data[0]).not.toHaveProperty('body');
    expect(listed.data[0]).not.toHaveProperty('isPublished');

    const searched = asPublicBlogListBody(
      (
        await request(server())
          .get('/api/v1/blogs')
          .query({ search: 'Draft packing' })
          .expect(200)
      ).body,
    );
    expect(searched.meta.total).toBe(0);
    expect(searched.data).toEqual([]);

    const titleSearch = asPublicBlogListBody(
      (
        await request(server())
          .get('/api/v1/blogs')
          .query({ search: 'Newer packing' })
          .expect(200)
      ).body,
    );
    expect(titleSearch.data.map((row) => row.slug)).toEqual([newer.slug]);

    const bodySearch = asPublicBlogListBody(
      (
        await request(server())
          .get('/api/v1/blogs')
          .query({ search: 'Published body' })
          .expect(200)
      ).body,
    );
    expect(bodySearch.meta.total).toBe(0);
  });

  it('returns published detail and treats draft detail like a missing slug', async () => {
    const published = seedBlog({
      slug: 'visible-post',
      title: 'Visible',
      body: '<p>Visible body</p>',
    });
    seedBlog({
      slug: 'hidden-draft',
      title: 'Hidden',
      isPublished: false,
      publishedAt: null,
    });

    const detail = asPublicBlogBody(
      (await request(server()).get('/api/v1/blogs/visible-post').expect(200))
        .body,
    );
    expect(detail.data).toEqual({
      id: published.id,
      slug: 'visible-post',
      title: 'Visible',
      body: '<p>Visible body</p>',
      publishedAt: published.publishedAt!.toISOString(),
    });

    const draft = await request(server())
      .get('/api/v1/blogs/hidden-draft')
      .expect(404);
    const missing = await request(server())
      .get('/api/v1/blogs/never-existed')
      .expect(404);
    expect(asApiErrorBody(draft.body).error.code).toBe('BLOG_NOT_FOUND');
    expect(asApiErrorBody(missing.body).error.code).toBe('BLOG_NOT_FOUND');
    expect(asApiErrorBody(draft.body).error.message).toBe(
      asApiErrorBody(missing.body).error.message,
    );
  });

  it('paginates without including drafts in counts and keeps id tie-break order', async () => {
    const publishedAt = new Date('2026-08-21T12:00:00.000Z');
    seedBlog({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      slug: 'alpha-post',
      title: 'Alpha',
      publishedAt,
    });
    seedBlog({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'beta-post',
      title: 'Beta',
      publishedAt,
    });
    seedBlog({
      slug: 'draft-post',
      title: 'Draft',
      isPublished: false,
      publishedAt: null,
    });

    const page1 = asPublicBlogListBody(
      (
        await request(server())
          .get('/api/v1/blogs')
          .query({ page: 1, pageSize: 1 })
          .expect(200)
      ).body,
    );
    expect(page1.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(page1.data.map((row) => row.slug)).toEqual(['beta-post']);

    const page2 = asPublicBlogListBody(
      (
        await request(server())
          .get('/api/v1/blogs')
          .query({ page: 2, pageSize: 1 })
          .expect(200)
      ).body,
    );
    expect(page2.data.map((row) => row.slug)).toEqual(['alpha-post']);
  });

  it('rejects invalid queries and invalid slugs without enumerating drafts', async () => {
    seedBlog({
      slug: 'hidden-draft',
      title: 'Hidden',
      isPublished: false,
      publishedAt: null,
    });

    const unknown = await request(server())
      .get('/api/v1/blogs')
      .query({ isPublished: true })
      .expect(400);
    expect(asApiErrorBody(unknown.body).error.code).toBe('BAD_REQUEST');

    const invalidPage = await request(server())
      .get('/api/v1/blogs')
      .query({ page: 0 })
      .expect(400);
    expect(asApiErrorBody(invalidPage.body).error.code).toBe('BAD_REQUEST');

    const invalidSlug = await request(server())
      .get('/api/v1/blogs/Not_Valid')
      .expect(400);
    expect(asApiErrorBody(invalidSlug.body).error.code).toBe(
      'BLOG_INVALID_SLUG',
    );
  });

  it('OpenAPI documents public Blog list and detail operations', () => {
    const openapi = createOpenApiDocument(app);
    const paths = openapi.paths ?? {};
    expect(paths['/api/v1/blogs']).toBeDefined();
    expect(paths['/api/v1/blogs/{slug}']).toBeDefined();
    expect(paths['/api/v1/admin/blogs']).toBeUndefined();

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
      expect.arrayContaining(['Blogs_list', 'Blogs_get']),
    );
    expect(operationIds).not.toEqual(
      expect.arrayContaining(['AdminBlogs_list', 'AdminBlogs_create']),
    );
  });
});
