import {
  Global,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import type { NestModule } from '@nestjs/common';
import { ApiExceptionFilter } from '../http/api-exception.filter';
import {
  ApplicationLogger,
  LOG_DESTINATION,
} from './application-logger.service';
import { NestLoggerAdapter } from './nest-logger.adapter';
import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: LOG_DESTINATION, useValue: process.stdout },
    ApplicationLogger,
    NestLoggerAdapter,
    RequestContextMiddleware,
    ApiExceptionFilter,
  ],
  exports: [
    RequestContextService,
    ApplicationLogger,
    NestLoggerAdapter,
    ApiExceptionFilter,
  ],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
