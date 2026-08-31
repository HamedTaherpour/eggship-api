import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from '../common/observability/observability.module';
import { createConfigModuleOptions } from '../config/config-module.options';
import { PrismaModule } from '../infrastructure/database/prisma/prisma.module';
import { AuditModule } from '../modules/audit/audit.module';
import { AdminIdentityService } from '../modules/admins/application/admin-identity.service';
import { AdminRepository } from '../modules/admins/infrastructure/admin.repository';
import { PASSWORD_HASHER } from '../modules/auth/auth.tokens';
import { Argon2PasswordHasher } from '../modules/auth/infrastructure/argon2-password-hasher';

/**
 * Narrow composition root for `pnpm admin:create`.
 * Boots Prisma + password hashing + Admin identity only — not Redis, OTP, HTTP,
 * or queue infrastructure.
 */
@Module({
  imports: [
    ConfigModule.forRoot(createConfigModuleOptions()),
    ObservabilityModule,
    PrismaModule,
    AuditModule,
  ],
  providers: [
    Argon2PasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },
    AdminRepository,
    AdminIdentityService,
  ],
})
export class AdminCreateCliModule {}
