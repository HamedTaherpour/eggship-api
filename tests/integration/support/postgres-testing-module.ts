import type {
  DynamicModule,
  ForwardReference,
  Provider,
  Type,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthorizationModule } from '../../../src/common/authz/authorization.module';
import { ADMIN_ROLE_RESOLVER } from '../../../src/common/authz/authorization.tokens';
import { ObservabilityModule } from '../../../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../../../src/config/config-module.options';
import { PrismaModule } from '../../../src/infrastructure/database/prisma/prisma.module';
import { AdminsModule } from '../../../src/modules/admins/admins.module';
import { PrismaAdminRoleResolver } from '../../../src/modules/admins/infrastructure/prisma-admin-role.resolver';
import { PricingService } from '../../../src/modules/pricing/application/pricing.service';

export type NestImport =
  Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * Composition-root-aligned baseline for Postgres integration suites.
 *
 * - ObservabilityModule is required whenever Auth/Redis is pulled (ApplicationLogger).
 * - AuthorizationModule.forRoot is required whenever a feature module registers
 *   admin controllers that use PermissionGuard.
 */
export function postgresIntegrationImports(
  extra: readonly NestImport[] = [],
): NestImport[] {
  return [
    ConfigModule.forRoot(createConfigModuleOptions()),
    ObservabilityModule,
    AuthorizationModule.forRoot({
      imports: [AdminsModule],
      adminRoleResolver: {
        provide: ADMIN_ROLE_RESOLVER,
        useExisting: PrismaAdminRoleResolver,
      },
    }),
    PrismaModule,
    ...extra,
  ];
}

/**
 * ProductService requires PricingService. Inventory-focused suites that only
 * create products (no price mutations) can stub it instead of importing the
 * full PricingModule graph.
 */
export function unusedPricingServiceProvider(): Provider {
  return {
    provide: PricingService,
    useValue: {
      requireAdminActor(): never {
        throw new Error(
          'PricingService stub: unexpected call in this integration suite',
        );
      },
      changeProductPrice(): never {
        throw new Error(
          'PricingService stub: unexpected call in this integration suite',
        );
      },
    },
  };
}
