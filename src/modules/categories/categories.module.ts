import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoriesController } from './api/admin-categories.controller';
import { CategoriesController } from './api/categories.controller';
import { CategoryService } from './application/category.service';
import { CategoryRepository } from './infrastructure/category.repository';

/**
 * Category reference resource (CAT-02).
 * Product (CAT-03) references Category via FK; Category does not own Product writes.
 * AuthModule is imported only so Admin routes can resolve AccessTokenGuard.
 */
@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoryRepository, CategoryService],
  exports: [CategoryService],
})
export class CategoriesModule {}
