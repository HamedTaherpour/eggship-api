import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponseDto } from '../../../common/openapi/dto/common-response.dto';
import { AdminLoginService } from '../application/admin-login.service';
import { AdminSessionLifecycleService } from '../application/admin-session-lifecycle.service';
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import {
  ADMIN_ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
} from '../domain/auth-cookies';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { AccessTokenGuard } from './access-token.guard';
import { extractAccessTokenFromRequest } from './access-token.extraction';
import { getAuthenticatedPrincipal } from './authenticated-principal.util';
import { AuthCookieWriter } from './auth-cookie.writer';
import { AuthSessionStatusResponseDto } from './dto/auth-session-status.dto';
import {
  AdminLoginBodyDto,
  AdminLoginResponseDto,
  CurrentAdminResponseDto,
} from './dto/admin-auth.dto';
import { resolveOtpRequestSource } from './request-source';

const AUTH_CACHE_CONTROL = 'no-store';

@ApiTags('AdminAuth')
@Controller('admin/auth')
export class AdminAuthController {
  private readonly cookies: AuthCookieWriter;

  constructor(
    private readonly login: AdminLoginService,
    private readonly lifecycle: AdminSessionLifecycleService,
    private readonly accessTokens: AccessTokenService,
    config: ConfigService,
  ) {
    this.cookies = new AuthCookieWriter(
      config.getOrThrow<string>('NODE_ENV'),
      'admin',
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'AdminAuth_login',
    summary: 'Authenticate an Admin with email and password',
    description: [
      'Verifies canonical email and password, creates an AdminAuthSession,',
      `sets HttpOnly \`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}\` / \`${ADMIN_REFRESH_TOKEN_COOKIE_NAME}\` cookies,`,
      'and returns a safe Admin identity. Tokens are never returned in JSON.',
      'Unknown email, wrong password, and malformed identifiers share AUTH_INVALID_CREDENTIALS.',
      'An inactive Admin that presents the correct password is AUTH_ACCOUNT_DISABLED (post-verification).',
      'Pre-authentication: authenticated-cookie CSRF does not apply to login.',
      'After cookies are set, cookie-authenticated mutations still require CSRF',
      '(shared production blocker with customer Auth).',
    ].join(' '),
  })
  @ApiBody({ type: AdminLoginBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Authenticated; Admin auth cookies set.',
    type: AdminLoginResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for Admin auth responses.',
        schema: { type: 'string', example: 'no-store' },
      },
      'Set-Cookie': {
        description: `HttpOnly \`${ADMIN_ACCESS_TOKEN_COOKIE_NAME}\` and \`${ADMIN_REFRESH_TOKEN_COOKIE_NAME}\` cookies.`,
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body (validation).',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials (`AUTH_INVALID_CREDENTIALS`).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Account disabled (`AUTH_ACCOUNT_DISABLED`).',
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Login attempt window exceeded (`AUTH_RATE_LIMITED`).',
    type: ApiErrorResponseDto,
    headers: {
      'Retry-After': {
        description: 'Seconds until another attempt may succeed.',
        schema: { type: 'integer', example: 60 },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'Login abuse controls unavailable (`AUTH_UNAVAILABLE`), for example Redis down in production.',
    type: ApiErrorResponseDto,
  })
  async loginAdmin(
    @Body() body: AdminLoginBodyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminLoginResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const result = await this.login.login({
      email: body.email,
      password: body.password,
      clientIp: resolveOtpRequestSource(request).clientIp,
    });

    this.cookies.setAuthCookies(
      response,
      {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      {
        accessTokenTtlSeconds: result.accessTokenTtlSeconds,
        refreshTokenMaxAgeSeconds: result.refreshTokenMaxAgeSeconds,
      },
    );

    return {
      data: {
        authenticated: true,
        admin: result.admin,
      },
    };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiOperation({
    operationId: 'AdminAuth_me',
    summary: 'Return the authenticated Admin identity',
    description: [
      'Requires a valid Admin access token (Admin access cookie or Bearer).',
      'Customer access cookies are ignored on this path.',
      'A USER subject receives AUTH_FORBIDDEN (403), not 401.',
      'Does not return passwordHash, tokens, or session secrets.',
      'Role is display-only; authorization still resolves permissions per request.',
    ].join(' '),
  })
  @ApiCookieAuth('adminAccessCookie')
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description: 'Current authenticated Admin.',
    type: CurrentAdminResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for Admin me responses.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token.',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Wrong subject type (`AUTH_FORBIDDEN`) or disabled Admin (`AUTH_ACCOUNT_DISABLED`).',
    type: ApiErrorResponseDto,
  })
  async me(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentAdminResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const principal = getAuthenticatedPrincipal(request);
    if (principal === undefined) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    const admin = await this.lifecycle.requireCurrentAdmin(principal);
    return { data: { admin } };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'AdminAuth_refresh',
    summary: 'Rotate the Admin refresh session and issue new Admin cookies',
    description: [
      `Reads the HttpOnly \`${ADMIN_REFRESH_TOKEN_COOKIE_NAME}\` cookie only.`,
      'A User refresh token cannot resolve as an Admin session (fail closed).',
      'CSRF protection for cookie-authenticated browser clients is required before production exposure.',
    ].join(' '),
  })
  @ApiCookieAuth('adminRefreshCookie')
  @ApiResponse({
    status: 200,
    description: 'Refresh succeeded; new Admin auth cookies are set.',
    type: AuthSessionStatusResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired, revoked, or reused refresh token (Auth error codes).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Account disabled (`AUTH_ACCOUNT_DISABLED`).',
    type: ApiErrorResponseDto,
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionStatusResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const refreshToken = this.cookies.readRefreshToken(request);
    if (refreshToken === undefined) {
      this.cookies.clearAuthCookies(response);
      throw new AuthError(
        AuthErrorCode.REFRESH_TOKEN_MISSING,
        'Refresh token cookie is missing.',
      );
    }

    try {
      const result = await this.lifecycle.refresh(refreshToken);
      this.cookies.setAuthCookies(
        response,
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
        {
          accessTokenTtlSeconds: result.accessTokenTtlSeconds,
          refreshTokenMaxAgeSeconds: result.refreshTokenMaxAgeSeconds,
        },
      );
      return { data: { authenticated: true } };
    } catch (error: unknown) {
      if (shouldClearAdminCookiesOnRefreshFailure(error)) {
        this.cookies.clearAuthCookies(response);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'AdminAuth_logout',
    summary: 'Revoke the current Admin session and clear Admin auth cookies',
    description: [
      'Revokes the AdminAuthSession bound to the current Admin access token when present.',
      'Clears Admin cookies only; User sessions are not affected.',
      'Idempotent when already logged out. CSRF middleware is required for browser production use.',
    ].join(' '),
  })
  @ApiResponse({
    status: 200,
    description: 'Admin cookies cleared; session revoked when identifiable.',
    type: AuthSessionStatusResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Authenticated non-Admin subject, or an Admin presenting a session it does not own (`AUTH_FORBIDDEN`). Admin cookies are still cleared.',
    type: ApiErrorResponseDto,
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionStatusResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    try {
      const principal = await this.tryResolvePrincipal(request);
      await this.lifecycle.logoutCurrent(principal);
    } finally {
      this.cookies.clearAuthCookies(response);
    }
    return { data: { authenticated: false } };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiOperation({
    operationId: 'AdminAuth_logoutAll',
    summary: 'Revoke all Admin sessions for the authenticated Admin',
    description: [
      'Requires a valid Admin access token (cookie or Bearer).',
      'Revokes every AdminAuthSession for that Admin only. User sessions are not affected.',
      'A USER subject receives AUTH_FORBIDDEN (403). CSRF is required for browser production use.',
    ].join(' '),
  })
  @ApiCookieAuth('adminAccessCookie')
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description:
      'All Admin sessions revoked for the subject; Admin cookies cleared.',
    type: AuthSessionStatusResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token.',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Authenticated principal is not an Admin subject (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  async logoutAll(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionStatusResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const principal = getAuthenticatedPrincipal(request);
    if (principal === undefined) {
      this.cookies.clearAuthCookies(response);
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    await this.lifecycle.logoutAll(principal);
    this.cookies.clearAuthCookies(response);
    return { data: { authenticated: false } };
  }

  private async tryResolvePrincipal(
    request: Request,
  ): Promise<AuthenticatedPrincipal | undefined> {
    let token: string | undefined;
    try {
      token = extractAccessTokenFromRequest(request, this.cookies);
    } catch {
      return undefined;
    }
    if (token === undefined) {
      return undefined;
    }

    try {
      const claims = await this.accessTokens.verifyAccessToken(token);
      return {
        subjectId: claims.subjectId,
        subjectType: claims.subjectType,
        sessionId: claims.sessionId,
      };
    } catch {
      return undefined;
    }
  }
}

function shouldClearAdminCookiesOnRefreshFailure(error: unknown): boolean {
  if (!(error instanceof AuthError)) {
    return true;
  }
  switch (error.code) {
    case AuthErrorCode.REFRESH_TOKEN_REUSED:
    case AuthErrorCode.REFRESH_TOKEN_MISSING:
    case AuthErrorCode.SESSION_EXPIRED:
    case AuthErrorCode.SESSION_REVOKED:
    case AuthErrorCode.ACCOUNT_DISABLED:
      return true;
    case AuthErrorCode.INVALID_TOKEN:
    case AuthErrorCode.TOKEN_EXPIRED:
    case AuthErrorCode.INVALID_CREDENTIALS:
    case AuthErrorCode.UNAUTHENTICATED:
    case AuthErrorCode.FORBIDDEN:
    case AuthErrorCode.COOLDOWN:
    case AuthErrorCode.RATE_LIMITED:
    case AuthErrorCode.LOGIN_RATE_LIMITED:
    case AuthErrorCode.INVALID:
    case AuthErrorCode.EXPIRED:
    case AuthErrorCode.TOO_MANY_ATTEMPTS:
    case AuthErrorCode.ALREADY_USED:
    case AuthErrorCode.DELIVERY_FAILED:
    case AuthErrorCode.UNAVAILABLE:
    case AuthErrorCode.AUTH_UNAVAILABLE:
    case AuthErrorCode.VERIFICATION_GRANT_INVALID:
    case AuthErrorCode.VERIFICATION_GRANT_EXPIRED:
    case AuthErrorCode.VERIFICATION_GRANT_USED:
    case AuthErrorCode.REGISTRATION_CONFLICT:
      return false;
    default: {
      const exhaustive: never = error.code;
      return exhaustive;
    }
  }
}
