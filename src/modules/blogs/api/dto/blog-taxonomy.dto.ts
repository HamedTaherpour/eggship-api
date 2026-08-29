import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BLOG_TAXONOMY_NAME_MAX_LENGTH } from '../../domain/blog-field';
import type { MediaPresentation } from '../../../media/domain/media-presentation';
export class BlogTaxonomyBodyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_TAXONOMY_NAME_MAX_LENGTH)
  name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) slug!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  avatarMediaId?: string | null;
}
export class BlogTaxonomyPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(BLOG_TAXONOMY_NAME_MAX_LENGTH)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  slug?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  avatarMediaId?: string | null;
}
export class BlogTaxonomyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) bio?: string | null;
  @ApiPropertyOptional() isActive?: boolean;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) avatarMediaId?:
    string | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  avatar?: MediaPresentation | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
export class BlogTaxonomyResponseDto {
  @ApiProperty({ type: BlogTaxonomyDto }) data!: BlogTaxonomyDto;
}
