import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import { NestLoggerAdapter } from './common/observability/nest-logger.adapter';
import { setupOpenApi } from './common/openapi/openapi.setup';
import { ApplicationReadinessService } from './common/health/application-readiness.service';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(NestLoggerAdapter));
  configureApplication(app);
  setupOpenApi(app);

  const readiness = app.get(ApplicationReadinessService);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    readiness.stopAdmission();
    await app.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

if (require.main === module)
  void bootstrap().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'API failed to start.',
    );
    process.exitCode = 1;
  });
