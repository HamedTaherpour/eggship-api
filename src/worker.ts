import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker.module';
import { WorkerService } from './infrastructure/worker/worker.service';
import { WORKER_PROCESSORS } from './infrastructure/worker/worker.tokens';
import type { WorkerProcessor } from './infrastructure/worker/worker.types';
import { NestLoggerAdapter } from './common/observability/nest-logger.adapter';

export async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(NestLoggerAdapter));
  const lifecycle = app.get(WorkerService);
  const processors =
    app.get<readonly WorkerProcessor[]>(WORKER_PROCESSORS, { strict: false }) ??
    [];
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await lifecycle.stop();
    await app.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  app.enableShutdownHooks();
  try {
    await lifecycle.start(processors);
  } catch (error: unknown) {
    await stop();
    throw error;
  }
}

if (require.main === module)
  void bootstrapWorker().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Worker failed to start.',
    );
    process.exitCode = 1;
  });
