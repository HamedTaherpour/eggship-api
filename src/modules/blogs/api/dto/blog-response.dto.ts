import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type {
  BlogRecord,
  BlogAuthorRecord,
  BlogTaxonomyRecord,
} from '../../domain/blog';

/** Public storefront blog list item. Body is detail-only to avoid large pages. */
export class PublicBlogListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cage-free-eggs' })
  slug!: string;

  @ApiProperty({ example: 'How we pack cage-free eggs' })
  title!: string;

  @ApiProperty({
    description:
      'UTC publication instant as ISO 8601. Not a Tehran wall-clock string.',
    example: '2026-08-21T12:00:00.000Z',
  })
  publishedAt!: string;
  @ApiProperty({ nullable: true }) excerpt!: string | null;
}

/** Public storefront blog detail. Body is stored Markdown source; this API does not render HTML. */
export class PublicBlogDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cage-free-eggs' })
  slug!: string;

  @ApiProperty({ example: 'How we pack cage-free eggs' })
  title!: string;

  @ApiProperty({
    description:
      'Stored post body is Markdown source; this API does not render it.',
    example: 'Pack eggs in a cool crate.',
  })
  body!: string;

  @ApiProperty({
    description:
      'UTC publication instant as ISO 8601. Not a Tehran wall-clock string.',
    example: '2026-08-21T12:00:00.000Z',
  })
  publishedAt!: string;
  @ApiProperty({ nullable: true }) excerpt!: string | null;
  @ApiProperty({ nullable: true }) seoTitle!: string | null;
  @ApiProperty({ nullable: true }) seoDescription!: string | null;
  @ApiProperty({ nullable: true }) author!: BlogAuthorRecord | null;
  @ApiProperty({ type: Object, isArray: true })
  categories!: BlogTaxonomyRecord[];
  @ApiProperty({ type: Object, isArray: true }) tags!: BlogTaxonomyRecord[];
}

export class PublicBlogResponseDto {
  @ApiProperty({ type: PublicBlogDetailDto })
  data!: PublicBlogDetailDto;
}

export const PublicBlogListResponseDto = createPaginatedResponseDto(
  PublicBlogListItemDto,
  { name: 'PublicBlogListResponseDto' },
);

/** Admin list item: includes lifecycle fields; body is detail-only. */
export class AdminBlogListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cage-free-eggs' })
  slug!: string;

  @ApiProperty({ example: 'How we pack cage-free eggs' })
  title!: string;

  @ApiProperty({ example: false })
  isPublished!: boolean;

  @ApiProperty({
    description:
      'UTC publication instant as ISO 8601 when the post was last published; null for never-published drafts.',
    nullable: true,
    example: '2026-08-21T12:00:00.000Z',
  })
  publishedAt!: string | null;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-21T12:00:00.000Z' })
  updatedAt!: string;
}

/** Admin detail: full editable fields including body. */
export class AdminBlogDetailDto extends AdminBlogListItemDto {
  @ApiProperty({
    description:
      'Stored post body is Markdown source; this API does not render it.',
    example: 'Pack eggs in a cool crate.',
  })
  body!: string;
  @ApiProperty({ nullable: true }) excerpt!: string | null;
  @ApiProperty({ nullable: true }) seoTitle!: string | null;
  @ApiProperty({ nullable: true }) seoDescription!: string | null;
  @ApiProperty({ nullable: true }) author!: BlogAuthorRecord | null;
  @ApiProperty({ type: Object, isArray: true })
  categories!: BlogTaxonomyRecord[];
  @ApiProperty({ type: Object, isArray: true }) tags!: BlogTaxonomyRecord[];
}

export class AdminBlogResponseDto {
  @ApiProperty({ type: AdminBlogDetailDto })
  data!: AdminBlogDetailDto;
}

export const AdminBlogListResponseDto = createPaginatedResponseDto(
  AdminBlogListItemDto,
  { name: 'AdminBlogListResponseDto' },
);

export function toPublicBlogListItemDto(
  record: BlogRecord,
): PublicBlogListItemDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    publishedAt: requirePublishedAt(record),
    excerpt: record.excerpt ?? null,
  };
}

export function toPublicBlogDetailDto(record: BlogRecord): PublicBlogDetailDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    body: record.body,
    publishedAt: requirePublishedAt(record),
    excerpt: record.excerpt ?? null,
    seoTitle: record.seoTitle ?? null,
    seoDescription: record.seoDescription ?? null,
    author: record.author ?? null,
    categories: record.categories ?? [],
    tags: record.tags ?? [],
  };
}

function requirePublishedAt(record: BlogRecord): string {
  if (record.publishedAt === null) {
    throw new Error(
      'Public Blog serialization requires publishedAt on published rows.',
    );
  }
  return record.publishedAt.toISOString();
}

export function toAdminBlogListItemDto(
  record: BlogRecord,
): AdminBlogListItemDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    isPublished: record.isPublished,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toAdminBlogDetailDto(record: BlogRecord): AdminBlogDetailDto {
  return {
    ...toAdminBlogListItemDto(record),
    body: record.body,
    excerpt: record.excerpt ?? null,
    seoTitle: record.seoTitle ?? null,
    seoDescription: record.seoDescription ?? null,
    author: record.author ?? null,
    categories: record.categories ?? [],
    tags: record.tags ?? [],
  };
}
