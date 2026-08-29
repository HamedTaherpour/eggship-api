import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import type { BlogRecord } from '../domain/blog';
import {
  BlogNotFoundError,
  BlogSlugConflictError,
} from '../domain/blog-errors';
import { AdminBlogListQueryDto } from '../api/dto/admin-blog-list-query.dto';
import { PublicBlogListQueryDto } from '../api/dto/public-blog-list-query.dto';
import {
  toAdminBlogDetailDto,
  toAdminBlogListItemDto,
  toPublicBlogDetailDto,
  toPublicBlogListItemDto,
} from '../api/dto/blog-response.dto';
import { BlogService } from './blog.service';
import type { BlogRepository } from '../infrastructure/blog.repository';

const PUBLISHED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PUBLISHED_AT = new Date('2026-08-21T12:00:00.000Z');

function blog(overrides: Partial<BlogRecord> = {}): BlogRecord {
  const now = new Date('2026-08-21T12:00:00.000Z');
  return {
    id: PUBLISHED_ID,
    slug: 'cage-free-eggs',
    title: 'How we pack cage-free eggs',
    body: 'Pack eggs in a cool crate.',
    isPublished: true,
    publishedAt: PUBLISHED_AT,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('BlogService', () => {
  let repository: jest.Mocked<
    Pick<
      BlogRepository,
      | 'listPublished'
      | 'findPublishedBySlug'
      | 'listAll'
      | 'findById'
      | 'create'
      | 'update'
      | 'publish'
      | 'unpublish'
    >
  >;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: BlogService;

  beforeEach(() => {
    repository = {
      listPublished: jest.fn(),
      findPublishedBySlug: jest.fn(),
      listAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      publish: jest.fn(),
      unpublish: jest.fn(),
    };
    logger = { info: jest.fn() };
    service = new BlogService(
      repository as unknown as BlogRepository,
      logger as unknown as ApplicationLogger,
    );
  });

  it('lists published posts through the published-only repository path', async () => {
    const published = blog();
    repository.listPublished.mockResolvedValue({
      items: [published],
      total: 1,
    });

    const page = await service.listPublic({ page: 1, pageSize: 20 });

    expect(repository.listPublished).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    expect(page.meta.total).toBe(1);
    expect(page.data.map((row: BlogRecord) => row.id)).toEqual([PUBLISHED_ID]);
  });

  it('returns published detail and hides unpublished as not found', async () => {
    repository.findPublishedBySlug.mockResolvedValue(blog());
    await expect(
      service.getPublicBySlug('Cage-Free-Eggs'),
    ).resolves.toMatchObject({ slug: 'cage-free-eggs' });
    expect(repository.findPublishedBySlug).toHaveBeenCalledWith(
      'cage-free-eggs',
    );

    repository.findPublishedBySlug.mockResolvedValue(null);
    await expect(
      service.getPublicBySlug('secret-draft'),
    ).rejects.toBeInstanceOf(BlogNotFoundError);
  });

  it('lists all posts for admin through listAll', async () => {
    const draft = blog({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      isPublished: false,
      publishedAt: null,
    });
    repository.listAll.mockResolvedValue({ items: [draft, blog()], total: 2 });

    const page = await service.listAdmin({
      page: 1,
      pageSize: 20,
      isPublished: false,
    });

    expect(repository.listAll).toHaveBeenCalledWith(
      expect.objectContaining({ isPublished: false }),
    );
    expect(page.meta.total).toBe(2);
  });

  it('creates drafts only and maps slug conflicts', async () => {
    const created = blog({ isPublished: false, publishedAt: null });
    repository.create.mockResolvedValue(created);

    await expect(
      service.create({
        slug: '  Cage-Free-Eggs ',
        title: 'Title',
        body: 'Body',
      }),
    ).resolves.toBe(created);

    expect(repository.create).toHaveBeenCalledWith({
      slug: '  Cage-Free-Eggs ',
      title: 'Title',
      body: 'Body',
      isPublished: false,
    });

    repository.create.mockRejectedValue(new BlogSlugConflictError());
    await expect(
      service.create({ slug: 'taken', title: 'Title', body: 'Body' }),
    ).rejects.toBeInstanceOf(BlogSlugConflictError);
  });

  it('updates allowlisted fields and throws when missing', async () => {
    repository.update.mockResolvedValue(blog({ title: 'Updated' }));
    await expect(
      service.update(PUBLISHED_ID, { title: 'Updated' }),
    ).resolves.toMatchObject({ title: 'Updated' });

    repository.update.mockResolvedValue(null);
    await expect(
      service.update(PUBLISHED_ID, { title: 'Nope' }),
    ).rejects.toBeInstanceOf(BlogNotFoundError);
  });

  it('publish and unpublish delegate to repository commands', async () => {
    const published = blog();
    repository.publish.mockResolvedValue(published);
    await expect(service.publish(PUBLISHED_ID)).resolves.toBe(published);

    const unpublished = blog({ isPublished: false, publishedAt: PUBLISHED_AT });
    repository.unpublish.mockResolvedValue(unpublished);
    await expect(service.unpublish(PUBLISHED_ID)).resolves.toBe(unpublished);

    repository.publish.mockResolvedValue(null);
    await expect(service.publish(PUBLISHED_ID)).rejects.toBeInstanceOf(
      BlogNotFoundError,
    );
  });

  it('serializes public DTOs without lifecycle or unpublished fields', () => {
    const published = blog();
    expect(toPublicBlogListItemDto(published)).toEqual({
      id: PUBLISHED_ID,
      slug: 'cage-free-eggs',
      title: 'How we pack cage-free eggs',
      excerpt: null,
      cover: null,
      publishedAt: '2026-08-21T12:00:00.000Z',
    });
    expect(toPublicBlogDetailDto(published)).toEqual({
      id: PUBLISHED_ID,
      slug: 'cage-free-eggs',
      title: 'How we pack cage-free eggs',
      body: 'Pack eggs in a cool crate.',
      excerpt: null,
      seoTitle: null,
      seoDescription: null,
      author: null,
      categories: [],
      tags: [],
      cover: null,
      inlineMedia: [],
      publishedAt: '2026-08-21T12:00:00.000Z',
    });
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty(
      'isPublished',
    );
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty('body');
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty('createdAt');
  });

  it('serializes admin DTOs with lifecycle fields', () => {
    const draft = blog({ isPublished: false, publishedAt: null });
    expect(toAdminBlogListItemDto(draft)).toEqual({
      id: PUBLISHED_ID,
      slug: 'cage-free-eggs',
      title: 'How we pack cage-free eggs',
      isPublished: false,
      publishedAt: null,
      createdAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z',
      cover: null,
    });
    expect(toAdminBlogDetailDto(draft).body).toBe('Pack eggs in a cool crate.');
  });

  it('rejects unknown public and admin list query parameters', async () => {
    const publicDto = plainToInstance(PublicBlogListQueryDto, {
      isPublished: 'true',
    });
    const publicErrors = await validate(publicDto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(publicErrors.length).toBeGreaterThan(0);

    const adminDto = plainToInstance(AdminBlogListQueryDto, {
      unknown: 'x',
    });
    const adminErrors = await validate(adminDto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(adminErrors.length).toBeGreaterThan(0);
  });
});
