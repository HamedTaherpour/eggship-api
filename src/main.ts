import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import { NestLoggerAdapter } from './common/observability/nest-logger.adapter';
import { setupOpenApi } from './common/openapi/openapi.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(NestLoggerAdapter));
  configureApplication(app);
  setupOpenApi(app);
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap();
