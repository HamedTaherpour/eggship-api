import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { BlogsController } from './api/blogs.controller';
import { BlogService } from './application/blog.service';
import { BlogRepository } from './infrastructure/blog.repository';

/**
 * Blog content resource (CNT-01).
 * Owns public published list/detail. Admin create/edit/publish is CNT-02.
 * Media attachment is MED-01 — this module has no Media FK.
 */
@Module({
  imports: [PrismaModule],
  controllers: [BlogsController],
  providers: [BlogRepository, BlogService],
  exports: [BlogService, BlogRepository],
})
export class BlogsModule {}
