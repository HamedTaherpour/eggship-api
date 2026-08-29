import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../src/generated/prisma/client';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('MED-01 deterministic attach/delete ordering (PostgreSQL)', () => {
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
        originalFileName: 'race.png',
        mimeType: 'image/png',
        sizeBytes: 16,
        width: 1,
        height: 1,
      })
    ).id;
  }
  async function setup(): Promise<{
    productId: string;
    blogId: string;
    authorId: string;
    categoryId: string;
  }> {
    const categoryId = (
      await prisma.category.create({ data: { name: 'Race eggs' } })
    ).id;
    const authorId = (
      await prisma.blogAuthor.create({
        data: { name: 'Race author', slug: `author-${randomUUID()}` },
      })
    ).id;
    const blogId = (
      await prisma.blog.create({
        data: { slug: `race-${randomUUID()}`, title: 'Race', body: 'Body' },
      })
    ).id;
    const productId = (
      await prisma.product.create({
        data: { name: 'Race product', price: 100, categoryId },
      })
    ).id;
    return { productId, blogId, authorId, categoryId };
  }
  async function lockMedia(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "Media" WHERE "id" = ${id}::uuid FOR UPDATE`;
    return rows.length === 1;
  }
  async function referenced(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<
      Array<{ referenced: boolean }>
    >(Prisma.sql`SELECT EXISTS (
      SELECT 1 FROM "Product" WHERE "imageMediaId" = ${id}::uuid
      UNION ALL SELECT 1 FROM "Blog" WHERE "coverMediaId" = ${id}::uuid
      UNION ALL SELECT 1 FROM "BlogAuthor" WHERE "avatarMediaId" = ${id}::uuid
      UNION ALL SELECT 1 FROM "BlogInlineMedia" WHERE "mediaId" = ${id}::uuid
    ) AS referenced`);
    return rows[0]?.referenced === true;
  }

  async function attachWins(
    name: string,
    attach: (
      tx: Prisma.TransactionClient,
      id: string,
      f: Deferred,
    ) => Promise<void>,
    assertReference: (id: string) => Promise<void>,
  ): Promise<void> {
    const id = await createMedia();
    const reached = deferred();
    const allowCommit = deferred();
    const attachTx = prisma.$transaction(async (tx) =>
      attach(tx, id, reached).then(() => allowCommit.promise),
    );
    await reached.promise;
    const deleteStarted = deferred();
    const deleteTx = prisma.$transaction(async (tx) => {
      deleteStarted.resolve();
      if (!(await lockMedia(tx, id))) throw new Error('MEDIA_NOT_FOUND');
      if (await referenced(tx, id)) throw new Error('MEDIA_REFERENCED');
      await tx.media.delete({ where: { id } });
    });
    await deleteStarted.promise;
    allowCommit.resolve();
    await expect(attachTx).resolves.toBeUndefined();
    await expect(deleteTx).rejects.toThrow('MEDIA_REFERENCED');
    await expect(assertReference(id)).resolves.toBeUndefined();
    await expect(
      prisma.media.findUnique({ where: { id } }),
    ).resolves.not.toBeNull();
    void name;
  }

  it('proves attach-wins serialization for Product, Blog cover, Blog inline, and BlogAuthor avatar', async () => {
    const { productId, blogId, authorId } = await setup();
    await attachWins(
      'Product image',
      async (tx, id, reached) => {
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
        expect(await lockMedia(tx, id)).toBe(true);
        reached.resolve();
        await tx.product.update({
          where: { id: productId },
          data: { imageMediaId: id },
        });
      },
      async (id): Promise<void> => {
        await expect(
          prisma.product.findUnique({ where: { id: productId } }),
        ).resolves.toMatchObject({ imageMediaId: id });
      },
    );
    await attachWins(
      'Blog cover',
      async (tx, id, reached) => {
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blogId} FOR UPDATE`;
        expect(await lockMedia(tx, id)).toBe(true);
        reached.resolve();
        await tx.blog.update({
          where: { id: blogId },
          data: { coverMediaId: id },
        });
      },
      async (id): Promise<void> => {
        await expect(
          prisma.blog.findUnique({ where: { id: blogId } }),
        ).resolves.toMatchObject({ coverMediaId: id });
      },
    );
    await attachWins(
      'Blog inline Media',
      async (tx, id, reached) => {
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blogId} FOR UPDATE`;
        expect(await lockMedia(tx, id)).toBe(true);
        reached.resolve();
        await tx.blogInlineMedia.create({ data: { blogId, mediaId: id } });
      },
      async (id): Promise<void> => {
        await expect(
          prisma.blogInlineMedia.findUnique({
            where: { blogId_mediaId: { blogId, mediaId: id } },
          }),
        ).resolves.not.toBeNull();
      },
    );
    await attachWins(
      'BlogAuthor avatar',
      async (tx, id, reached) => {
        await tx.$queryRaw`SELECT "id" FROM "BlogAuthor" WHERE "id" = ${authorId} FOR UPDATE`;
        expect(await lockMedia(tx, id)).toBe(true);
        reached.resolve();
        await tx.blogAuthor.update({
          where: { id: authorId },
          data: { avatarMediaId: id },
        });
      },
      async (id) =>
        expect(
          prisma.blogAuthor.findUnique({ where: { id: authorId } }),
        ).resolves.toMatchObject({ avatarMediaId: id }),
    );
  });

  it('proves delete-wins leaves no reference for Product, Blog inline, and BlogAuthor', async () => {
    const { productId, blogId, authorId } = await setup();
    for (const attach of [
      async (
        tx: Prisma.TransactionClient,
        id: string,
        started: Deferred,
      ): Promise<void> => {
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
        started.resolve();
        if (!(await lockMedia(tx, id))) throw new Error('MEDIA_NOT_FOUND');
        await tx.product.update({
          where: { id: productId },
          data: { imageMediaId: id },
        });
      },
      async (
        tx: Prisma.TransactionClient,
        id: string,
        started: Deferred,
      ): Promise<void> => {
        await tx.$queryRaw`SELECT "id" FROM "Blog" WHERE "id" = ${blogId} FOR UPDATE`;
        started.resolve();
        if (!(await lockMedia(tx, id))) throw new Error('MEDIA_NOT_FOUND');
        await tx.blogInlineMedia.create({ data: { blogId, mediaId: id } });
      },
      async (
        tx: Prisma.TransactionClient,
        id: string,
        started: Deferred,
      ): Promise<void> => {
        await tx.$queryRaw`SELECT "id" FROM "BlogAuthor" WHERE "id" = ${authorId} FOR UPDATE`;
        started.resolve();
        if (!(await lockMedia(tx, id))) throw new Error('MEDIA_NOT_FOUND');
        await tx.blogAuthor.update({
          where: { id: authorId },
          data: { avatarMediaId: id },
        });
      },
    ]) {
      const id = await createMedia();
      const deleteReached = deferred();
      const allowDelete = deferred();
      const deleteTx = prisma.$transaction(async (tx) => {
        expect(await lockMedia(tx, id)).toBe(true);
        deleteReached.resolve();
        await allowDelete.promise;
        if (!(await referenced(tx, id)))
          await tx.media.delete({ where: { id } });
      });
      await deleteReached.promise;
      const attachStarted = deferred();
      const attachTx = prisma.$transaction(async (tx) => {
        await attach(tx, id, attachStarted);
      });
      await attachStarted.promise;
      allowDelete.resolve();
      await expect(deleteTx).resolves.toBeUndefined();
      await expect(attachTx).rejects.toThrow();
      await expect(
        prisma.media.findUnique({ where: { id } }),
      ).resolves.toBeNull();
      await expect(
        prisma.product.findUnique({ where: { id: productId } }),
      ).resolves.toMatchObject({ imageMediaId: null });
      await expect(
        prisma.blogInlineMedia.count({ where: { blogId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.blogAuthor.findUnique({ where: { id: authorId } }),
      ).resolves.toMatchObject({ avatarMediaId: null });
    }
  });
});
