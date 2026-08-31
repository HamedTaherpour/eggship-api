import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminIdentityService } from './application/admin-identity.service';
import { AdminRepository } from './infrastructure/admin.repository';
import { PrismaAdminRoleResolver } from './infrastructure/prisma-admin-role.resolver';

/**
 * Admin identity: persistence, canonical email, credential storage boundary, and
 * the real `AdminRoleResolver` implementation.
 *
 * `AuthModule` is imported for the `PASSWORD_HASHER` port only, so Admin shares
 * one password hashing policy with Auth. Nothing here imports
 * `AuthorizationModule`: the composition root passes
 * `PrismaAdminRoleResolver` into `AuthorizationModule.forRoot()`, which is what
 * keeps authorization free of a dependency on a business module (ADR 0007).
 */
@Module({
  imports: [PrismaModule, AuditModule, forwardRef(() => AuthModule)],
  providers: [AdminRepository, PrismaAdminRoleResolver, AdminIdentityService],
  exports: [PrismaAdminRoleResolver, AdminIdentityService],
})
export class AdminsModule {}
