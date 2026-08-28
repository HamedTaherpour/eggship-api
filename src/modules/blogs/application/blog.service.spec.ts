import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { BlogRecord } from '../domain/blog';
import { BlogNotFoundError } from '../domain/blog-errors';
import { PublicBlogListQueryDto } from '../api/dto/public-blog-list-query.dto';
import {
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
    body: '<p>Pack eggs in a cool crate.</p>',
    isPublished: true,
    publishedAt: PUBLISHED_AT,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('BlogService', () => {
  let repository: jest.Mocked<
    Pick<BlogRepository, 'listPublished' | 'findPublishedBySlug'>
  >;
  let service: BlogService;

  beforeEach(() => {
    repository = {
      listPublished: jest.fn(),
      findPublishedBySlug: jest.fn(),
    };
    service = new BlogService(repository as unknown as BlogRepository);
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
    expect(page.data.map((row) => row.id)).toEqual([PUBLISHED_ID]);
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

  it('serializes public DTOs without lifecycle or unpublished fields', () => {
    const published = blog();
    expect(toPublicBlogListItemDto(published)).toEqual({
      id: PUBLISHED_ID,
      slug: 'cage-free-eggs',
      title: 'How we pack cage-free eggs',
      publishedAt: '2026-08-21T12:00:00.000Z',
    });
    expect(toPublicBlogDetailDto(published)).toEqual({
      id: PUBLISHED_ID,
      slug: 'cage-free-eggs',
      title: 'How we pack cage-free eggs',
      body: '<p>Pack eggs in a cool crate.</p>',
      publishedAt: '2026-08-21T12:00:00.000Z',
    });
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty(
      'isPublished',
    );
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty('body');
    expect(toPublicBlogListItemDto(published)).not.toHaveProperty('createdAt');
  });

  it('rejects unknown public list query parameters', async () => {
    const dto = plainToInstance(PublicBlogListQueryDto, {
      isPublished: 'true',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
