import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import type { EnvironmentVariables } from './config/environment.validation';
import { CsrfGuard } from './modules/auth/api/csrf.guard';
import type { ValidationError } from 'class-validator';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const allowedOrigins = config.getOrThrow<
    EnvironmentVariables['CSRF_ALLOWED_ORIGINS']
  >('CSRF_ALLOWED_ORIGINS');
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]): BadRequestException =>
        new BadRequestException({ message: errors }),
    }),
  );
  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.useGlobalGuards(app.get(CsrfGuard));
}
