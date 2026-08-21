import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import type { EnvironmentVariables } from '../../config/environment.validation';
import { resolveOpenApiEnabled } from './openapi-exposure';
import { OPENAPI_JSON_PATH, OPENAPI_UI_PATH } from './openapi.constants';
import { createOpenApiDocument } from './openapi.document';

export function setupOpenApi(app: INestApplication): boolean {
  const config = app.get(ConfigService);
  const nodeEnv =
    config.getOrThrow<EnvironmentVariables['NODE_ENV']>('NODE_ENV');
  const openApiEnabled = config.get<boolean | undefined>('OPENAPI_ENABLED');
  const enabled = resolveOpenApiEnabled(nodeEnv, openApiEnabled);

  if (!enabled) {
    return false;
  }

  const document = createOpenApiDocument(app);
  SwaggerModule.setup(OPENAPI_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    swaggerOptions: {
      persistAuthorization: false,
    },
  });

  return true;
}
