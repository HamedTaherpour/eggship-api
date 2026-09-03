import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCustomersController } from './api/admin-customers.controller';
import { AdminCustomerService } from './application/admin-customer.service';
import { AdminCustomerRepository } from './infrastructure/admin-customer.repository';

/**
 * Admin store/customer read module (ADM-02).
 *
 * Kept separate from `UsersModule` so the storefront identity module never
 * carries admin guard/authorization dependencies. `AuthorizationModule`
 * is global (authorization.md), so no import is needed here; guards resolve
 * through the composition root like every other permissioned admin surface.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomerRepository, AdminCustomerService],
  exports: [AdminCustomerRepository, AdminCustomerService],
})
export class AdminCustomersModule {}
