import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ADMIN_ROLE_RESOLVER } from './common/authz/authorization.tokens';
import { AuthorizationModule } from './common/authz/authorization.module';
import { HealthController } from './common/health/health.controller';
import { ObservabilityModule } from './common/observability/observability.module';
import { createConfigModuleOptions } from './config/config-module.options';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module';
import { QueueInfrastructureModule } from './infrastructure/queue/queue-infrastructure.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AdminsModule } from './modules/admins/admins.module';
import { PrismaAdminRoleResolver } from './modules/admins/infrastructure/prisma-admin-role.resolver';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { MediaModule } from './modules/media/media.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { RegionsModule } from './modules/regions/regions.module';
import { UsersModule } from './modules/users/users.module';
import { AdminCustomersModule } from './modules/users/admin-customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CommercePolicyModule } from './modules/commerce-policy/commerce-policy.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { BlogsModule } from './modules/blogs/blogs.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminAuditModule } from './modules/audit/admin-audit.module';

@Module({
  imports: [
    ConfigModule.forRoot(createConfigModuleOptions()),
    ObservabilityModule,
    // The composition root supplies the admin role resolver so authorization
    // never imports a business module (ADR 0007). Call `forRoot` exactly once.
    AuthorizationModule.forRoot({
      imports: [AdminsModule],
      adminRoleResolver: {
        provide: ADMIN_ROLE_RESOLVER,
        useExisting: PrismaAdminRoleResolver,
      },
    }),
    PrismaModule,
    RedisModule,
    QueueInfrastructureModule,
    UsersModule,
    AdminCustomersModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    PricingModule,
    InventoryModule,
    MediaModule,
    RegionsModule,
    OrdersModule,
    CommercePolicyModule,
    SettlementsModule,
    OutboxModule,
    NotificationsModule,
    VisitorsModule,
    BlogsModule,
    AuditModule,
    AdminAuditModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
