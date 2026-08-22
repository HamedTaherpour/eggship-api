import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthResponseDto } from '../health/dto/health-response.dto';
import {
  ApiErrorResponseDto,
  ApiInternalErrorResponseDto,
  ExamplePaginatedResponseDto,
  PaginationMetaDto,
} from './dto/common-response.dto';
import { AuthSessionStatusResponseDto } from '../../modules/auth/api/dto/auth-session-status.dto';
import {
  CompleteAuthResponseDto,
  CurrentUserResponseDto,
} from '../../modules/auth/api/dto/auth-complete.dto';
import {
  AdminLoginResponseDto,
  CurrentAdminResponseDto,
} from '../../modules/auth/api/dto/admin-auth.dto';
import {
  RequestOtpResponseDto,
  VerifyOtpResponseDto,
} from '../../modules/auth/api/dto/auth-otp.dto';
import { UpdateUserProfileBodyDto } from '../../modules/users/api/dto/update-user-profile.dto';
import {
  AdminCategoryDto,
  AdminCategoryResponseDto,
  PublicCategoryDto,
  PublicCategoryListResponseDto,
} from '../../modules/categories/api/dto/category-response.dto';
import { CreateCategoryBodyDto } from '../../modules/categories/api/dto/create-category.dto';
import { UpdateCategoryBodyDto } from '../../modules/categories/api/dto/update-category.dto';
import {
  AdminRegionDto,
  AdminRegionResponseDto,
  PublicRegionDto,
  PublicRegionListResponseDto,
} from '../../modules/regions/api/dto/region-response.dto';
import { CreateRegionBodyDto } from '../../modules/regions/api/dto/create-region.dto';
import { UpdateRegionBodyDto } from '../../modules/regions/api/dto/update-region.dto';

export function buildOpenApiConfig(
  appVersion: string,
): ReturnType<DocumentBuilder['build']> {
  return new DocumentBuilder()
    .setTitle('EggShip API')
    .setDescription(
      [
        'Standalone HTTP API for EggShip.',
        'Business routes are versioned under `/api/v1`.',
        '`info.version` is the application release version (APP_VERSION), not the URL contract version.',
        'Every response includes an `X-Request-Id` header; error bodies repeat the same value as `requestId`.',
        'Browser customer auth uses HttpOnly cookies `eggship_at` / `eggship_rt`.',
        'Browser Admin auth uses HttpOnly cookies `eggship_admin_at` / `eggship_admin_rt` (Path=/api/v1/admin).',
        'Authorization Bearer remains supported for tooling when it does not conflict with the path-appropriate access cookie.',
        'Cookie-authenticated mutating Auth routes require CSRF protection before production browser exposure.',
        'Examples are synthetic and must never contain real credentials or production secrets.',
      ].join(' '),
    )
    .setVersion(appVersion)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token via Authorization Bearer. Supported alongside the `eggship_at` cookie; conflicting values are rejected.',
      },
      'bearer',
    )
    .addCookieAuth('accessCookie', {
      type: 'apiKey',
      in: 'cookie',
      name: 'eggship_at',
      description: 'HttpOnly storefront access-token cookie.',
    })
    .addCookieAuth('refreshCookie', {
      type: 'apiKey',
      in: 'cookie',
      name: 'eggship_rt',
      description: 'HttpOnly refresh-token cookie for storefront clients.',
    })
    .addCookieAuth('adminAccessCookie', {
      type: 'apiKey',
      in: 'cookie',
      name: 'eggship_admin_at',
      description:
        'HttpOnly Admin access-token cookie. Path=/api/v1/admin. Distinct from `eggship_at`.',
    })
    .addCookieAuth('adminRefreshCookie', {
      type: 'apiKey',
      in: 'cookie',
      name: 'eggship_admin_rt',
      description:
        'HttpOnly Admin refresh-token cookie. Path=/api/v1/admin. Distinct from `eggship_rt`.',
    })
    .addTag('Health', 'Process liveness')
    .addTag(
      'Auth',
      'OTP, customer auth completion, current user, session refresh, and logout.',
    )
    .addTag(
      'AdminAuth',
      'Admin email/password login, current Admin, session refresh, and logout.',
    )
    .addTag('Users', 'Authenticated customer/store profile')
    .addTag('Categories', 'Public product category reference list')
    .addTag('Regions', 'Public region reference list')
    .addTag('AdminCategories', 'Admin category reference management')
    .addTag('AdminRegions', 'Admin region reference management')
    .addTag('AdminProducts', 'Admin product catalog management')
    .addTag('AdminMedia', 'Admin media library metadata and uploads')
    .addTag('AdminPricing', 'Admin product price changes and price history')
    .addTag('AdminDiscounts', 'Admin discount lifecycle management')
    .build();
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = app.get(ConfigService);
  const appVersion = config.getOrThrow<string>('APP_VERSION');

  return SwaggerModule.createDocument(app, buildOpenApiConfig(appVersion), {
    extraModels: [
      HealthResponseDto,
      AuthSessionStatusResponseDto,
      CompleteAuthResponseDto,
      CurrentUserResponseDto,
      AdminLoginResponseDto,
      CurrentAdminResponseDto,
      RequestOtpResponseDto,
      VerifyOtpResponseDto,
      UpdateUserProfileBodyDto,
      PublicCategoryDto,
      PublicCategoryListResponseDto,
      AdminCategoryDto,
      AdminCategoryResponseDto,
      CreateCategoryBodyDto,
      UpdateCategoryBodyDto,
      PublicRegionDto,
      PublicRegionListResponseDto,
      AdminRegionDto,
      AdminRegionResponseDto,
      CreateRegionBodyDto,
      UpdateRegionBodyDto,
      ApiErrorResponseDto,
      ApiInternalErrorResponseDto,
      PaginationMetaDto,
      ExamplePaginatedResponseDto,
    ],
  });
}
