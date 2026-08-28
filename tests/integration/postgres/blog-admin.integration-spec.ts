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

describe('Blog admin persistence (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let blogs: BlogRepository;
  let blogService: BlogService;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin create/update/publish/unpublish persist publication semantics', async () => {
    const created = await blogService.create({
      slug: 'admin-draft',
      title: 'Admin draft',
      body: '<p>Draft body</p>',
    });
    expect(created.isPublished).toBe(false);
    expect(created.publishedAt).toBeNull();

    const updated = await blogService.update(created.id, {
      title: 'Updated draft',
    });
    expect(updated.title).toBe('Updated draft');

    const firstPublishAt = new Date('2026-08-28T12:00:00.000Z');
    const published = await blogService.publish(created.id, firstPublishAt);
    expect(published.isPublished).toBe(true);
    expect(published.publishedAt?.toISOString()).toBe(
      firstPublishAt.toISOString(),
    );

    const replay = await blogService.publish(
      created.id,
      new Date('2026-08-29T12:00:00.000Z'),
    );
    expect(replay.publishedAt?.toISOString()).toBe(
      firstPublishAt.toISOString(),
    );

    await expect(
      blogService.getPublicBySlug('admin-draft'),
    ).resolves.toMatchObject({
      id: created.id,
    });

    const unpublished = await blogService.unpublish(created.id);
    expect(unpublished.isPublished).toBe(false);
    expect(unpublished.publishedAt?.toISOString()).toBe(
      firstPublishAt.toISOString(),
    );

    await expect(
      blogService.getPublicBySlug('admin-draft'),
    ).rejects.toMatchObject({
      code: 'BLOG_NOT_FOUND',
    });

    const adminDetail = await blogService.getAdminById(created.id);
    expect(adminDetail.isPublished).toBe(false);

    const republished = await blogService.publish(
      created.id,
      new Date('2026-08-30T12:00:00.000Z'),
    );
    expect(republished.publishedAt?.toISOString()).toBe(
      '2026-08-30T12:00:00.000Z',
    );
  });

  it('maps duplicate slug conflicts on create and update', async () => {
    const first = await blogs.create({
      slug: 'shared-slug',
      title: 'First',
      body: 'First body',
      isPublished: false,
    });

    await expect(
      blogs.create({
        slug: 'shared-slug',
        title: 'Second',
        body: 'Second body',
        isPublished: false,
      }),
    ).rejects.toBeInstanceOf(BlogSlugConflictError);

    const other = await blogs.create({
      slug: 'other-slug',
      title: 'Other',
      body: 'Other body',
      isPublished: false,
    });

    await expect(
      blogs.update(other.id, { slug: 'shared-slug' }),
    ).rejects.toBeInstanceOf(BlogSlugConflictError);

    const unchanged = await blogs.findById(first.id);
    expect(unchanged?.slug).toBe('shared-slug');
  });
});
