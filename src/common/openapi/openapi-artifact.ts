import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { configureApplication } from '../../app.setup';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { OPENAPI_ARTIFACT_PATH } from './openapi.constants';
import { createOpenApiDocument } from './openapi.document';

export async function createOpenApiApplication(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({
      onModuleInit: (): void => undefined,
      onModuleDestroy: (): void => undefined,
    })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

export async function writeOpenApiArtifact(
  absolutePath = resolve(process.cwd(), OPENAPI_ARTIFACT_PATH),
): Promise<string> {
  const app = await createOpenApiApplication();
  try {
    const document = createOpenApiDocument(app);
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, serialized, 'utf8');
    return absolutePath;
  } finally {
    await app.close();
  }
}
