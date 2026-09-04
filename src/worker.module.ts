import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createWorkerConfigModuleOptions } from './config/worker-config-module.options';
import { ObservabilityModule } from './common/observability/observability.module';
import { QueueInfrastructureModule } from './infrastructure/queue/queue-infrastructure.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { WorkerModule } from './infrastructure/worker/worker.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AsyncRecoveryModule } from './modules/async-recovery/async-recovery.module';
import { WORKER_PROCESSORS } from './infrastructure/worker/worker.tokens';
import { RECOVERY_PROCESSORS } from './modules/async-recovery/domain/async-recovery';
import { OrderStatusNotificationProcessor } from './modules/notifications/application/order-status-notification.processor';
import { FcmPushDeliveryProvider } from './modules/notifications/infrastructure/fcm-push-delivery.provider';
import { PUSH_DELIVERY_PROVIDER } from './modules/notifications/domain/push-delivery-provider';

@Module({
  imports: [
    ConfigModule.forRoot(createWorkerConfigModuleOptions()),
    ObservabilityModule,
    RedisModule,
    QueueInfrastructureModule,
    WorkerModule.register(),
    NotificationsModule,
    AsyncRecoveryModule,
  ],
  providers: [
    FcmPushDeliveryProvider,
    { provide: PUSH_DELIVERY_PROVIDER, useExisting: FcmPushDeliveryProvider },
    OrderStatusNotificationProcessor,
    {
      provide: WORKER_PROCESSORS,
      useFactory: (
        processor: OrderStatusNotificationProcessor,
      ): OrderStatusNotificationProcessor[] => [processor],
      inject: [OrderStatusNotificationProcessor],
    },
    {
      provide: RECOVERY_PROCESSORS,
      useFactory: (
        processor: OrderStatusNotificationProcessor,
      ): OrderStatusNotificationProcessor[] => [processor],
      inject: [OrderStatusNotificationProcessor],
    },
  ],
})
export class WorkerAppModule {}
