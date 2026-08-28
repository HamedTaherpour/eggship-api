import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BLOG_BODY_MAX_LENGTH } from '../../domain/blog-body';
import { BLOG_SLUG_MAX_LENGTH } from '../../domain/blog-slug';
import { BLOG_TITLE_MAX_LENGTH } from '../../domain/blog-title';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * PATCH allowlist. Publication uses dedicated publish/unpublish routes.
 */
export class UpdateBlogBodyDto {
  @ApiPropertyOptional({
    description:
      'Canonical lowercase kebab-case slug. Trimmed and lowercased; unique across all rows.',
    minLength: 1,
    maxLength: BLOG_SLUG_MAX_LENGTH,
    example: 'cage-free-eggs',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_SLUG_MAX_LENGTH)
  slug?: string;

  @ApiPropertyOptional({
    description: 'Post title. Trimmed; 1–200 characters.',
    minLength: 1,
    maxLength: BLOG_TITLE_MAX_LENGTH,
    example: 'How we pack cage-free eggs',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description:
      'Stored post body (HTML or Markdown). Trimmed; not sanitized by this API.',
    minLength: 1,
    maxLength: BLOG_BODY_MAX_LENGTH,
    example: '<p>Pack eggs in a cool crate.</p>',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_BODY_MAX_LENGTH)
  body?: string;
}
