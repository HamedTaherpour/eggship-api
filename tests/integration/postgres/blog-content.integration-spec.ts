import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { BlogService } from '../../../src/modules/blogs/application/blog.service';
import { BlogSlugConflictError } from '../../../src/modules/blogs/domain/blog-errors';
import { BlogRepository } from '../../../src/modules/blogs/infrastructure/blog.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function truncateBlogTable(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Blog" RESTART IDENTITY CASCADE',
  );
}

describe('Blog persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let blogs: BlogRepository;
  let blogService: BlogService;
  let authorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
      ],
      providers: [BlogRepository, BlogService],
    }).compile();

    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    blogs = moduleRef.get(BlogRepository);
    blogService = moduleRef.get(BlogService);
    await app.init();
  });

  beforeEach(async () => {
    await truncateBlogTable(prisma);
    const author = await prisma.blogAuthor.create({
      data: {
        id: randomUUID(),
        name: 'Test Author',
        slug: `test-author-${randomUUID()}`,
      },
    });
    authorId = author.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates published posts with canonical slug and UTC publishedAt', async () => {
    const created = await blogs.create({
      slug: '  Cage-Free-Eggs  ',
      title: '  Packing notes  ',
      body: '  Keep crates cool.  ',
      isPublished: true,
      authorId,
    });

    expect(created).toMatchObject({
      slug: 'cage-free-eggs',
      title: 'Packing notes',
      body: 'Keep crates cool.',
      isPublished: true,
    });
    expect(created.publishedAt).toBeInstanceOf(Date);

    const publicDetail = await blogService.getPublicBySlug('Cage-Free-Eggs');
    expect(publicDetail.id).toBe(created.id);
  });

  it('enforces slug uniqueness including drafts', async () => {
    await blogs.create({
      slug: 'shared-slug',
      title: 'Draft',
      body: 'Draft body',
      isPublished: false,
    });

    await expect(
      blogs.create({
        slug: 'shared-slug',
        title: 'Other',
        body: 'Other body',
        isPublished: true,
        authorId,
      }),
    ).rejects.toBeInstanceOf(BlogSlugConflictError);

    await expect(
      prisma.blog.create({
        data: {
          slug: 'shared-slug',
          title: 'Raw',
          body: 'Raw body',
          isPublished: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces canonical slug, publication, and body CHECKs', async () => {
    await expect(
      prisma.blog.create({
        data: {
          slug: 'Not Canonical',
          title: 'Title',
          body: 'Body',
          isPublished: false,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.blog.create({
        data: {
          slug: 'published-missing-time',
          title: 'Title',
          body: 'Body',
          isPublished: true,
          authorId,
          publishedAt: null,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.blog.create({
        data: {
          slug: 'empty-body',
          title: 'Title',
          body: '',
          isPublished: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects whitespace-only title and body on direct PostgreSQL writes', async () => {
    await expect(
      prisma.blog.create({
        data: {
          slug: 'whitespace-title',
          title: '\t\n\r',
          body: 'Body',
          isPublished: false,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.blog.create({
        data: {
          slug: 'whitespace-body',
          title: 'Title',
          body: ' \t\n\r ',
          isPublished: false,
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps listPublished fail-closed while listAll can see drafts', async () => {
    const visible = await blogs.create({
      slug: 'visible-post',
      title: 'Visible packing',
      body: 'Visible body',
      isPublished: true,
      authorId,
      publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    await blogs.create({
      slug: 'hidden-draft',
      title: 'Draft packing',
      body: 'Draft body',
      isPublished: false,
    });

    const publishedPage = await blogs.listPublished({
      page: 1,
      pageSize: 20,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    expect(publishedPage.total).toBe(1);
    expect(publishedPage.items.map((row) => row.id)).toEqual([visible.id]);

    const allPage = await blogs.listAll({
      page: 1,
      pageSize: 20,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    expect(allPage.total).toBe(2);
  });

  it('hides drafts from public list, detail, search, and pagination totals', async () => {
    const visible = await blogs.create({
      slug: 'visible-post',
      title: 'Visible packing',
      body: 'Visible body',
      isPublished: true,
      authorId,
      publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    await blogs.create({
      slug: 'hidden-draft',
      title: 'Draft packing',
      body: 'Draft body',
      isPublished: false,
    });

    const page = await blogService.listPublic({ page: 1, pageSize: 20 });
    expect(page.meta.total).toBe(1);
    expect(page.data.map((row) => row.id)).toEqual([visible.id]);

    const searched = await blogService.listPublic({
      page: 1,
      pageSize: 20,
      search: 'Draft packing',
    });
    expect(searched.meta.total).toBe(0);
    expect(searched.data).toEqual([]);

    expect(await blogs.findPublishedBySlug('hidden-draft')).toBeNull();
    await expect(
      blogService.getPublicBySlug('hidden-draft'),
    ).rejects.toMatchObject({
      code: 'BLOG_NOT_FOUND',
    });
  });

  it('orders public lists by publishedAt with a stable id tie-break', async () => {
    const publishedAt = new Date('2026-08-21T12:00:00.000Z');
    await prisma.blog.create({
      data: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        slug: 'alpha-post',
        title: 'Alpha',
        body: 'Alpha body',
        isPublished: true,
        authorId,
        publishedAt,
      },
    });
    await prisma.blog.create({
      data: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        slug: 'beta-post',
        title: 'Beta',
        body: 'Beta body',
        isPublished: true,
        authorId,
        publishedAt,
      },
    });

    const page = await blogService.listPublic({
      page: 1,
      pageSize: 20,
    });
    expect(page.data.map((row) => row.slug)).toEqual([
      'beta-post',
      'alpha-post',
    ]);

    const sliced = await blogService.listPublic({
      page: 1,
      pageSize: 1,
    });
    expect(sliced.meta.total).toBe(2);
    expect(sliced.data.map((row) => row.slug)).toEqual(['beta-post']);
  });
});
