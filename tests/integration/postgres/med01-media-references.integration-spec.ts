import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../../../src/generated/prisma/client';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { PrismaService } from '../../../src/infrastructure/database/prisma/prisma.service';
import { PrismaTransactionContext } from '../../../src/infrastructure/database/prisma/prisma-transaction-context';
import { MediaRepository } from '../../../src/modules/media/infrastructure/media.repository';
import { ConcurrencyGate } from '../support/concurrency-gate';
import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

async function reset(prisma: PrismaService): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "BlogInlineMedia", "OrderSettlement", "OrderLine", "Order", "Product", "Blog", "BlogAuthor", "Category", "Region", "User", "Admin", "Media" RESTART IDENTITY CASCADE',
  );
}

describe('MED-01 Media reference contract (PostgreSQL)', () => {
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

  beforeEach(() => reset(prisma));
  afterAll(() => app.close());

  async function createMedia(): Promise<string> {
    return (
      await media.create({
        storageKey: `media/2026/08/${randomUUID()}.png`,
        originalFileName: 'proof.png',
        mimeType: 'image/png',
        sizeBytes: 16,
        width: 1,
        height: 1,
      })
    ).id;
  }

  it('enforces every restrictive Media FK in PostgreSQL and preserves nullable references', async () => {
    const productMedia = await createMedia();
    const coverMedia = await createMedia();
    const avatarMedia = await createMedia();
    const inlineMedia = await createMedia();
    const receiptMedia = await createMedia();
    const category = await prisma.category.create({ data: { name: 'Eggs' } });
    const author = await prisma.blogAuthor.create({
      data: {
        name: 'Author',
        slug: `author-${randomUUID()}`,
        avatarMediaId: avatarMedia,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Eggs',
        price: 100,
        categoryId: category.id,
        imageMediaId: productMedia,
      },
    });
    const blog = await prisma.blog.create({
      data: {
        slug: `post-${randomUUID()}`,
        title: 'Post',
        body: 'Body',
        coverMediaId: coverMedia,
        authorId: author.id,
      },
    });
    await prisma.blogInlineMedia.create({
      data: { blogId: blog.id, mediaId: inlineMedia },
    });
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const user = await prisma.user.create({
      data: {
        phone: `+989${randomUUID().replace(/\D/gu, '').slice(0, 9).padEnd(9, '0')}`,
      },
    });
    const region = await prisma.region.create({ data: { name: 'Region' } });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        regionId: region.id,
        regionName: region.name,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        customerPhone: user.phone,
        grossSubtotal: 100n,
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: 100n,
        orderDiscountAmount: 0n,
        total: 100n,
        pricingEvaluatedAt: new Date(),
      },
    });
    await prisma.orderSettlement.create({
      data: {
        orderId: order.id,
        dueAt: new Date(),
        createdByAdminId: admin.id,
        receiptMediaId: receiptMedia,
        receiptAttachedAt: new Date(),
        receiptAttachedByAdminId: admin.id,
      },
    });

    for (const id of [
      productMedia,
      coverMedia,
      avatarMedia,
      inlineMedia,
      receiptMedia,
    ]) {
      await expect(prisma.media.delete({ where: { id } })).rejects.toThrow();
    }

    const nullable = await createMedia();
    const nullableProduct = await prisma.product.create({
      data: { name: 'No image', price: 100, categoryId: category.id },
    });
    const nullableBlog = await prisma.blog.create({
      data: { slug: `draft-${randomUUID()}`, title: 'Draft', body: 'Body' },
    });
    const nullableAuthor = await prisma.blogAuthor.create({
      data: { name: 'No avatar', slug: `author-${randomUUID()}` },
    });
    expect(nullableProduct.imageMediaId).toBeNull();
    expect(nullableBlog.coverMediaId).toBeNull();
    expect(nullableAuthor.avatarMediaId).toBeNull();
    await prisma.media.delete({ where: { id: nullable } });
    expect(
      await prisma.product.findUnique({ where: { id: product.id } }),
    ).not.toBeNull();
  });

  it('enforces inline Blog FKs and composite uniqueness, and reports all durable usages deterministically', async () => {
    const id = await createMedia();
    const category = await prisma.category.create({ data: { name: 'Eggs' } });
    const product = await prisma.product.create({
      data: {
        name: 'Eggs',
        price: 100,
        categoryId: category.id,
        imageMediaId: id,
      },
    });
    const author = await prisma.blogAuthor.create({
      data: {
        name: 'Author',
        slug: `author-${randomUUID()}`,
        avatarMediaId: id,
      },
    });
    const blog = await prisma.blog.create({
      data: {
        slug: `post-${randomUUID()}`,
        title: 'Post',
        body: 'Body',
        coverMediaId: id,
        authorId: author.id,
      },
    });
    await prisma.blogInlineMedia.create({
      data: { blogId: blog.id, mediaId: id },
    });
    await expect(
      prisma.blogInlineMedia.create({ data: { blogId: blog.id, mediaId: id } }),
    ).rejects.toThrow();
    await expect(
      prisma.blogInlineMedia.create({
        data: { blogId: randomUUID(), mediaId: id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.blogInlineMedia.create({
        data: { blogId: blog.id, mediaId: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(media.usages(id)).resolves.toEqual([
      { type: 'BLOG_AUTHOR_AVATAR', id: author.id },
      { type: 'BLOG_COVER', id: blog.id },
      { type: 'BLOG_INLINE', id: blog.id },
      { type: 'PRODUCT_IMAGE', id: product.id },
    ]);
  });

  it('makes concurrent attach/delete outcomes deterministic for every restrictive Media reference', async () => {
    const category = await prisma.category.create({
      data: { name: 'Race eggs' },
    });
    const author = await prisma.blogAuthor.create({
      data: { name: 'Race author', slug: `race-author-${randomUUID()}` },
    });
    const blog = await prisma.blog.create({
      data: {
        slug: `race-blog-${randomUUID()}`,
        title: 'Race blog',
        body: 'Body',
        authorId: author.id,
      },
    });
    const admin = await prisma.admin.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'x'.repeat(32),
        role: 'SUPER_ADMIN',
      },
    });
    const user = await prisma.user.create({
      data: {
        phone: `+989${randomUUID().replace(/\D/gu, '').slice(0, 9).padEnd(9, '0')}`,
      },
    });
    const region = await prisma.region.create({
      data: { name: 'Race region' },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        regionId: region.id,
        regionName: region.name,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        customerPhone: user.phone,
        grossSubtotal: 100n,
        lineDiscountTotal: 0n,
        subtotalAfterLineDiscounts: 100n,
        orderDiscountAmount: 0n,
        total: 100n,
        pricingEvaluatedAt: new Date(),
      },
    });
    const settlement = await prisma.orderSettlement.create({
      data: {
        orderId: order.id,
        dueAt: new Date(),
        createdByAdminId: admin.id,
      },
    });
    const product = await prisma.product.create({
      data: { name: 'Race product', price: 100, categoryId: category.id },
    });

    type AttachOperation = (
      tx: Prisma.TransactionClient,
      mediaId: string,
    ) => Promise<void>;
    const cases: Array<{ name: string; attach: AttachOperation }> = [
      {
        name: 'Product image',
        attach: (tx, mediaId) =>
          tx.product
            .update({
              where: { id: product.id },
              data: { imageMediaId: mediaId },
            })
            .then(() => undefined),
      },
      {
        name: 'Blog cover',
        attach: (tx, mediaId) =>
          tx.blog
            .update({
              where: { id: blog.id },
              data: { coverMediaId: mediaId },
            })
            .then(() => undefined),
      },
      {
        name: 'Blog author avatar',
        attach: (tx, mediaId) =>
          tx.blogAuthor
            .update({
              where: { id: author.id },
              data: { avatarMediaId: mediaId },
            })
            .then(() => undefined),
      },
      {
        name: 'Blog inline media',
        attach: (tx, mediaId) =>
          tx.blogInlineMedia
            .create({
              data: { blogId: blog.id, mediaId },
            })
            .then(() => undefined),
      },
      {
        name: 'Settlement receipt',
        attach: (tx, mediaId) =>
          tx.orderSettlement
            .update({
              where: { id: settlement.id },
              data: {
                receiptMediaId: mediaId,
                receiptAttachedAt: new Date(),
                receiptAttachedByAdminId: admin.id,
              },
            })
            .then(() => undefined),
      },
    ];

    for (const testCase of cases) {
      const mediaId = await createMedia();
      const gate = new ConcurrencyGate(2);
      const attach = prisma.$transaction(async (tx) => {
        await gate.arriveAndWait();
        const context = new PrismaTransactionContext(tx);
        const existing = await media.findByIdForReference(mediaId, context);
        if (existing === null) throw new Error('MEDIA_NOT_FOUND');
        await testCase.attach(tx, mediaId);
      });
      const deleteAttempt = prisma.$transaction(async (tx) => {
        await gate.arriveAndWait();
        const context = new PrismaTransactionContext(tx);
        const existing = await media.findByIdForReference(mediaId, context);
        if (existing === null) throw new Error('MEDIA_NOT_FOUND');
        if (await media.isReferenced(mediaId, context)) {
          throw new Error('MEDIA_REFERENCED');
        }
        await media.deleteById(mediaId, context);
      });

      const [attachResult, deleteResult] = await Promise.allSettled([
        attach,
        deleteAttempt,
      ]);
      const attachWon =
        attachResult.status === 'fulfilled' &&
        deleteResult.status === 'rejected';
      const deleteWon =
        attachResult.status === 'rejected' &&
        deleteResult.status === 'fulfilled';
      expect(attachWon || deleteWon).toBe(true);
      const remaining = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(remaining === null).toBe(deleteWon);
    }
  });
});
