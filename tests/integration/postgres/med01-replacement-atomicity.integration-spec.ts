import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

describe('MED-01 replacement atomicity (PostgreSQL)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let media: MediaRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        PrismaModule,
      ],
      providers: [MediaRepository],
    }).compile();
    app = moduleRef;
    prisma = moduleRef.get(PrismaService);
    media = moduleRef.get(MediaRepository);
    await app.init();
  });

  beforeEach(async () => {
    assertDestructiveOperationsAllowed();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "BlogInlineMedia", "Product", "Blog", "BlogAuthor", "Category", "Media" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(() => app.close());

  async function createMedia(): Promise<string> {
    return (
      await media.create({
        storageKey: `media/2026/08/${randomUUID()}.png`,
        originalFileName: 'replacement.png',
        mimeType: 'image/png',
        sizeBytes: 16,
        width: 1,
        height: 1,
      })
    ).id;
  }

  async function category(): Promise<string> {
    return (
      await prisma.category.create({ data: { name: 'Replacement eggs' } })
    ).id;
  }

  it('replaces Product image atomically and retains both Media rows', async () => {
    const a = await createMedia();
    const b = await createMedia();
    const product = await prisma.product.create({
      data: {
        name: 'Product',
        price: 100,
        categoryId: await category(),
        imageMediaId: a,
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${b}::uuid FOR UPDATE`;
      await tx.product.update({
        where: { id: product.id },
        data: { imageMediaId: b },
      });
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${randomUUID()}::uuid FOR UPDATE`;
        throw new Error('MEDIA_NOT_FOUND');
      }),
    ).rejects.toThrow('MEDIA_NOT_FOUND');

    await expect(
      prisma.product.findUnique({ where: { id: product.id } }),
    ).resolves.toMatchObject({ imageMediaId: b });
    await expect(
      prisma.media.findMany({ where: { id: { in: [a, b] } } }),
    ).resolves.toHaveLength(2);
    await expect(media.usages(a)).resolves.toEqual([]);
    await expect(media.usages(b)).resolves.toEqual([
      { type: 'PRODUCT_IMAGE', id: product.id },
    ]);
  });

  it('replaces Blog cover atomically and rolls back an unusable replacement', async () => {
    const a = await createMedia();
    const b = await createMedia();
    const blog = await prisma.blog.create({
      data: {
        slug: `replacement-${randomUUID()}`,
        title: 'Blog',
        body: 'Original',
        coverMediaId: a,
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blog.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${b}::uuid FOR UPDATE`;
      await tx.blog.update({
        where: { id: blog.id },
        data: { coverMediaId: b },
      });
    });
    await expect(
      prisma.blog.findUnique({ where: { id: blog.id } }),
    ).resolves.toMatchObject({ coverMediaId: b });
    await expect(
      prisma.media.findMany({ where: { id: { in: [a, b] } } }),
    ).resolves.toHaveLength(2);
    await expect(media.usages(a)).resolves.toEqual([]);
    await expect(media.usages(b)).resolves.toEqual([
      { type: 'BLOG_COVER', id: blog.id },
    ]);

    const original = await prisma.blog.findUniqueOrThrow({
      where: { id: blog.id },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blog.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${randomUUID()}::uuid FOR UPDATE`;
        await tx.blog.update({
          where: { id: blog.id },
          data: { body: 'must rollback', coverMediaId: randomUUID() },
        });
      }),
    ).rejects.toThrow();
    await expect(
      prisma.blog.findUnique({ where: { id: blog.id } }),
    ).resolves.toMatchObject({ body: original.body, coverMediaId: b });
  });

  it('replaces BlogAuthor avatar atomically and retains the old avatar', async () => {
    const a = await createMedia();
    const b = await createMedia();
    const author = await prisma.blogAuthor.create({
      data: {
        name: 'Author',
        slug: `author-${randomUUID()}`,
        avatarMediaId: a,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BlogAuthor" WHERE "id" = ${author.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${b}::uuid FOR UPDATE`;
      await tx.blogAuthor.update({
        where: { id: author.id },
        data: { avatarMediaId: b },
      });
    });
    await expect(
      prisma.blogAuthor.findUnique({ where: { id: author.id } }),
    ).resolves.toMatchObject({ avatarMediaId: b });
    await expect(
      prisma.media.findMany({ where: { id: { in: [a, b] } } }),
    ).resolves.toHaveLength(2);
    await expect(media.usages(a)).resolves.toEqual([]);
    await expect(media.usages(b)).resolves.toEqual([
      { type: 'BLOG_AUTHOR_AVATAR', id: author.id },
    ]);
  });

  it('updates the inline registry exactly and rolls back body and registry together', async () => {
    const a = await createMedia();
    const b = await createMedia();
    const c = await createMedia();
    const blog = await prisma.blog.create({
      data: {
        slug: `inline-${randomUUID()}`,
        title: 'Inline',
        body: `old-${a}-${b}`,
      },
    });
    await prisma.blogInlineMedia.createMany({
      data: [
        { blogId: blog.id, mediaId: a },
        { blogId: blog.id, mediaId: b },
      ],
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blog.id} FOR UPDATE`;
      for (const id of [b, c].sort()) {
        await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${id}::uuid FOR UPDATE`;
      }
      await tx.blog.update({
        where: { id: blog.id },
        data: { body: `new-${b}-${c}` },
      });
      await tx.blogInlineMedia.deleteMany({ where: { blogId: blog.id } });
      await tx.blogInlineMedia.createMany({
        data: [
          { blogId: blog.id, mediaId: b },
          { blogId: blog.id, mediaId: c },
        ],
      });
    });
    await expect(
      prisma.blog.findUnique({ where: { id: blog.id } }),
    ).resolves.toMatchObject({ body: `new-${b}-${c}` });
    await expect(
      prisma.blogInlineMedia.findMany({
        where: { blogId: blog.id },
        orderBy: { mediaId: 'asc' },
      }),
    ).resolves.toEqual(
      [b, c].sort().map((mediaId) => ({ blogId: blog.id, mediaId })),
    );
    await expect(
      prisma.media.findMany({ where: { id: { in: [a, b, c] } } }),
    ).resolves.toHaveLength(3);
    await expect(media.usages(a)).resolves.toEqual([]);
    await expect(media.usages(b)).resolves.toEqual([
      { type: 'BLOG_INLINE', id: blog.id },
    ]);
    await expect(media.usages(c)).resolves.toEqual([
      { type: 'BLOG_INLINE', id: blog.id },
    ]);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blog.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${randomUUID()}::uuid FOR UPDATE`;
        await tx.blog.update({
          where: { id: blog.id },
          data: { body: 'invalid' },
        });
        await tx.blogInlineMedia.deleteMany({ where: { blogId: blog.id } });
        throw new Error('MEDIA_NOT_FOUND');
      }),
    ).rejects.toThrow('MEDIA_NOT_FOUND');
    await expect(
      prisma.blog.findUnique({ where: { id: blog.id } }),
    ).resolves.toMatchObject({ body: `new-${b}-${c}` });
    await expect(
      prisma.blogInlineMedia.count({ where: { blogId: blog.id } }),
    ).resolves.toBe(2);
  });
});
