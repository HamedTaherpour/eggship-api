import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { postgresIntegrationImports } from '../support/postgres-testing-module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { BlogTaxonomyService } from '../../../src/modules/blogs/application/blog-taxonomy.service';
import { BlogRepository } from '../../../src/modules/blogs/infrastructure/blog.repository';
import { BlogAuthorInactiveError } from '../../../src/modules/blogs/domain/blog-errors';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';
import { ConcurrencyGate } from '../support/concurrency-gate';

async function truncateBlogContent(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "BlogCategoryOnBlog", "BlogTagOnBlog", "Blog", "BlogAuthor", "BlogCategory", "BlogTag" CASCADE',
  );
}

describe('Blog CNT-04 concurrency (PostgreSQL)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let blogs: BlogRepository;
  let taxonomy: BlogTaxonomyService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [...postgresIntegrationImports()],
      providers: [BlogRepository, BlogTaxonomyService],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    blogs = moduleRef.get(BlogRepository);
    taxonomy = moduleRef.get(BlogTaxonomyService);
    await app.init();
  });

  beforeEach(async () => truncateBlogContent(prisma));

  afterAll(async () => app.close());

  it('serializes publish against author deactivation with only coherent outcomes', async () => {
    const author = await prisma.blogAuthor.create({
      data: {
        id: randomUUID(),
        name: 'Concurrent Author',
        slug: `author-${randomUUID()}`,
      },
    });
    const blog = await blogs.create({
      slug: `concurrent-publish-${randomUUID()}`,
      title: 'Concurrent publish',
      body: 'Body',
      authorId: author.id,
    });
    const gate = new ConcurrencyGate(2);

    const [published, deactivated] = await Promise.allSettled([
      (async (): Promise<unknown> => {
        await gate.arriveAndWait();
        return blogs.publish(blog.id, new Date('2026-08-29T12:00:00.000Z'));
      })(),
      (async (): Promise<unknown> => {
        await gate.arriveAndWait();
        return taxonomy.update('author', author.id, { isActive: false });
      })(),
    ]);

    const finalBlog = await prisma.blog.findUnique({ where: { id: blog.id } });
    const finalAuthor = await prisma.blogAuthor.findUnique({
      where: { id: author.id },
    });
    expect(finalBlog?.isPublished).toBe(published.status === 'fulfilled');
    expect(finalAuthor?.isActive).toBe(false);
    if (published.status === 'rejected') {
      expect(published.reason).toBeInstanceOf(BlogAuthorInactiveError);
    }
    expect(deactivated.status).toBe('fulfilled');
  });

  it('serializes author association replacement against author deactivation', async () => {
    const first = await prisma.blogAuthor.create({
      data: {
        id: randomUUID(),
        name: 'First Author',
        slug: `first-${randomUUID()}`,
      },
    });
    const second = await prisma.blogAuthor.create({
      data: {
        id: randomUUID(),
        name: 'Second Author',
        slug: `second-${randomUUID()}`,
      },
    });
    const blog = await blogs.create({
      slug: `concurrent-author-${randomUUID()}`,
      title: 'Concurrent author',
      body: 'Body',
      authorId: first.id,
    });
    const gate = new ConcurrencyGate(2);

    const [updated, deactivated] = await Promise.allSettled([
      (async (): Promise<unknown> => {
        await gate.arriveAndWait();
        return blogs.update(blog.id, { authorId: second.id });
      })(),
      (async (): Promise<unknown> => {
        await gate.arriveAndWait();
        return taxonomy.update('author', second.id, { isActive: false });
      })(),
    ]);

    const finalBlog = await prisma.blog.findUnique({ where: { id: blog.id } });
    const finalAuthor = await prisma.blogAuthor.findUnique({
      where: { id: second.id },
    });
    expect(deactivated.status).toBe('fulfilled');
    expect(finalAuthor?.isActive).toBe(false);
    expect(finalBlog?.authorId).toBe(
      updated.status === 'fulfilled' ? second.id : first.id,
    );
    if (updated.status === 'rejected') {
      expect(updated.reason).toBeInstanceOf(BlogAuthorInactiveError);
    }
  });

  it('keeps the published-author invariant on direct PostgreSQL writes', async () => {
    await expect(
      prisma.blog.create({
        data: {
          slug: `missing-author-${randomUUID()}`,
          title: 'Missing author',
          body: 'Body',
          isPublished: true,
          publishedAt: new Date('2026-08-29T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });
});
