import './openapi-process-env';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApplication } from '../../app.setup';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { assertOpenApiDocument } from './openapi-check';
import { resolveOpenApiEnabled } from './openapi-exposure';
import { createOpenApiDocument } from './openapi.document';
import { setupOpenApi } from './openapi.setup';

/** AppModule boot is heavier after catalog modules; keep a bounded allowance. */
const APP_BOOT_TIMEOUT_MS = 30_000;

async function createApp(): Promise<INestApplication> {
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
  return app;
}

describe('OpenAPI foundation', () => {
  afterEach(() => {
    delete process.env['OPENAPI_ENABLED'];
  });

  it('resolves exposure defaults by environment', () => {
    expect(resolveOpenApiEnabled('development', undefined)).toBe(true);
    expect(resolveOpenApiEnabled('test', undefined)).toBe(false);
    expect(resolveOpenApiEnabled('production', undefined)).toBe(false);
    expect(resolveOpenApiEnabled('production', true)).toBe(true);
    expect(resolveOpenApiEnabled('development', false)).toBe(false);
  });

  it(
    'generates a document with Health_get under /api/v1/health',
    async () => {
      const app = await createApp();
      await app.init();

      try {
        const document = createOpenApiDocument(app);
        const failures = assertOpenApiDocument(document);
        expect(failures).toEqual([]);

        const healthSchema =
          document.paths?.['/api/v1/health']?.get?.responses?.['200'];
        expect(healthSchema).toBeDefined();
        expect(document.paths?.['/health']).toBeUndefined();
        expect(document.components?.securitySchemes?.['bearer']).toBeDefined();
        expect(JSON.stringify(document)).not.toContain(
          'postgresql://openapi.invalid',
        );
        expect(document.info.version).toBe(process.env['APP_VERSION']);

        const okContent =
          healthSchema !== undefined &&
          'content' in healthSchema &&
          healthSchema.content !== undefined
            ? healthSchema.content['application/json']
            : undefined;
        expect(okContent?.schema).toBeDefined();
      } finally {
        await app.close();
      }
    },
    APP_BOOT_TIMEOUT_MS,
  );

  it(
    'keeps docs disabled in test unless OPENAPI_ENABLED=true',
    async () => {
      const disabledApp = await createApp();
      expect(setupOpenApi(disabledApp)).toBe(false);
      await disabledApp.init();
      try {
        await request(disabledApp.getHttpServer() as Server)
          .get('/docs-json')
          .expect(404);
      } finally {
        await disabledApp.close();
      }

      process.env['OPENAPI_ENABLED'] = 'true';
      const enabledModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({
          onModuleInit: (): void => undefined,
          onModuleDestroy: (): void => undefined,
        })
        .overrideProvider(ConfigService)
        .useValue({
          getOrThrow: (key: string): string | number | boolean => {
            const values: Record<string, string | number | boolean> = {
              NODE_ENV: 'test',
              PORT: 3000,
              APP_VERSION: process.env['APP_VERSION'] ?? '0.1.0',
              GIT_SHA: process.env['GIT_SHA'] ?? 'openapi-generate',
              DATABASE_URL:
                process.env['DATABASE_URL'] ??
                'postgresql://openapi.invalid:5432/eggship_openapi',
              JWT_ACCESS_SECRET:
                process.env['JWT_ACCESS_SECRET'] ??
                'openapi-jwt-access-secret-at-least-32ch',
              CSRF_SECRET:
                process.env['CSRF_SECRET'] ??
                'openapi-csrf-secret-at-least-32-characters!!',
              CSRF_ALLOWED_ORIGINS:
                process.env['CSRF_ALLOWED_ORIGINS'] ?? 'http://localhost:3000',
              JWT_ACCESS_TTL_SECONDS: 900,
              REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
              OTP_PROVIDER: 'development',
              OTP_HASH_SECRET: 'openapi-otp-hash-secret-at-least-32ch!',
              OTP_DEV_CODE: '111111',
              OTP_TTL_SECONDS: 300,
              OTP_MAX_ATTEMPTS: 5,
              OTP_RESEND_COOLDOWN_SECONDS: 60,
              OTP_PHONE_WINDOW_SECONDS: 3600,
              OTP_PHONE_WINDOW_LIMIT: 5,
              OTP_IP_WINDOW_SECONDS: 3600,
              OTP_IP_WINDOW_LIMIT: 20,
              OTP_VERIFICATION_GRANT_TTL_SECONDS: 600,
              STORAGE_PROVIDER: 'memory',
              STORAGE_PUBLIC_BASE_URL: 'https://media.local.invalid',
              STORAGE_FORCE_PATH_STYLE: true,
              MEDIA_MAX_FILE_BYTES: 5_242_880,
              MEDIA_MAX_FILES_PER_BATCH: 10,
              MEDIA_MAX_BATCH_BYTES: 26_214_400,
              MEDIA_UPLOAD_CONCURRENCY: 3,
            };
            const value = values[key];
            if (value === undefined) {
              throw new Error(`${key} is required.`);
            }
            return value;
          },
          get: (key: string): boolean | undefined => {
            if (key === 'OPENAPI_ENABLED') {
              return true;
            }
            return undefined;
          },
        })
        .compile();

      const enabledApp = enabledModule.createNestApplication();
      configureApplication(enabledApp);
      expect(setupOpenApi(enabledApp)).toBe(true);
      await enabledApp.init();
      try {
        const response = await request(enabledApp.getHttpServer() as Server)
          .get('/docs-json')
          .expect(200);
        const body: unknown = response.body;
        expect(body).toMatchObject({
          info: { title: 'EggShip API' },
          paths: {
            '/api/v1/health': {
              get: { operationId: 'Health_get' },
            },
          },
        });
      } finally {
        await enabledApp.close();
      }
    },
    APP_BOOT_TIMEOUT_MS,
  );
});
