import { Module, forwardRef } from '@nestjs/common';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminBlogsController } from './api/admin-blogs.controller';
import {
  AdminBlogTaxonomyController,
  PublicBlogTaxonomyController,
} from './api/blog-taxonomy.controller';
import { BlogsController } from './api/blogs.controller';
import { BlogService } from './application/blog.service';
import { BlogRepository } from './infrastructure/blog.repository';
import { BlogTaxonomyService } from './application/blog-taxonomy.service';

/**
 * Blog content resource (CNT-01 public read; CNT-02 Admin management).
 * Owns public published list/detail and Admin create/edit/publish/unpublish.
 * Media attachment is MED-01 — this module has no Media FK.
 * AuthModule is imported only so Admin routes can resolve AccessTokenGuard.
 */
@Module({
  imports: [PrismaModule, ObservabilityModule, forwardRef(() => AuthModule)],
  controllers: [
    BlogsController,
    AdminBlogsController,
    AdminBlogTaxonomyController,
    PublicBlogTaxonomyController,
  ],
  providers: [BlogRepository, BlogService, BlogTaxonomyService],
  exports: [BlogService, BlogRepository],
})
export class BlogsModule {}
