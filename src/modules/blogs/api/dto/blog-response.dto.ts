import { ApiProperty } from '@nestjs/swagger';
import { createPaginatedResponseDto } from '../../../../common/list';
import type { BlogRecord } from '../../domain/blog';

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
}

/** Public storefront blog detail. Body is stored markup; this API does not sanitize. */
export class PublicBlogDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'cage-free-eggs' })
  slug!: string;

  @ApiProperty({ example: 'How we pack cage-free eggs' })
  title!: string;

  @ApiProperty({
    description:
      'Stored post body (HTML or Markdown). Rendering and XSS prevention belong to the client.',
    example: '<p>Pack eggs in a cool crate.</p>',
  })
  body!: string;

  @ApiProperty({
    description:
      'UTC publication instant as ISO 8601. Not a Tehran wall-clock string.',
    example: '2026-08-21T12:00:00.000Z',
  })
  publishedAt!: string;
}

export class PublicBlogResponseDto {
  @ApiProperty({ type: PublicBlogDetailDto })
  data!: PublicBlogDetailDto;
}

export const PublicBlogListResponseDto = createPaginatedResponseDto(
  PublicBlogListItemDto,
  { name: 'PublicBlogListResponseDto' },
);

export function toPublicBlogListItemDto(
  record: BlogRecord,
): PublicBlogListItemDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    publishedAt: requirePublishedAt(record),
  };
}

export function toPublicBlogDetailDto(record: BlogRecord): PublicBlogDetailDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    body: record.body,
    publishedAt: requirePublishedAt(record),
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
