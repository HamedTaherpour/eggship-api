import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BLOG_BODY_MAX_LENGTH } from '../../domain/blog-body';
import { BLOG_SLUG_MAX_LENGTH } from '../../domain/blog-slug';
import { BLOG_TITLE_MAX_LENGTH } from '../../domain/blog-title';
import {
  BLOG_EXCERPT_MAX_LENGTH,
  BLOG_SEO_DESCRIPTION_MAX_LENGTH,
  BLOG_SEO_TITLE_MAX_LENGTH,
} from '../../domain/blog-field';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Admin create body. Always creates a draft; publish uses POST .../publish.
 */
export class CreateBlogBodyDto {
  @ApiProperty({
    description:
      'Canonical lowercase kebab-case slug. Trimmed and lowercased; not generated from title.',
    minLength: 1,
    maxLength: BLOG_SLUG_MAX_LENGTH,
    example: 'cage-free-eggs',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_SLUG_MAX_LENGTH)
  slug!: string;

  @ApiProperty({
    description: 'Post title. Trimmed; 1–200 characters.',
    minLength: 1,
    maxLength: BLOG_TITLE_MAX_LENGTH,
    example: 'How we pack cage-free eggs',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({
    description:
      'Stored post body is Markdown source with controlled directives; it is never rendered as HTML by this API.',
    minLength: 1,
    maxLength: BLOG_BODY_MAX_LENGTH,
    example: 'Pack eggs in a cool crate.',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({ maxLength: BLOG_EXCERPT_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(BLOG_EXCERPT_MAX_LENGTH)
  excerpt?: string | null;
  @ApiPropertyOptional({ maxLength: BLOG_SEO_TITLE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(BLOG_SEO_TITLE_MAX_LENGTH)
  seoTitle?: string | null;
  @ApiPropertyOptional({
    maxLength: BLOG_SEO_DESCRIPTION_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(BLOG_SEO_DESCRIPTION_MAX_LENGTH)
  seoDescription?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  authorId?: string | null;
  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsUUID('4', { each: true })
  categoryIds?: string[];
  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsUUID('4', { each: true })
  tagIds?: string[];
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  coverMediaId?: string | null;
}
