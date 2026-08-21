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
import { AuthError } from '../domain/auth-error';
import { AuthErrorCode } from '../domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { CustomerAuthCompletionService } from '../application/customer-auth-completion.service';
import { OtpService } from '../application/otp.service';
import { SessionLifecycleService } from '../application/session-lifecycle.service';
import { CustomerProfileService } from '../../users/application/customer-profile.service';
import { AccessTokenGuard } from './access-token.guard';
import { getAuthenticatedPrincipal } from './authenticated-principal.util';
import { AuthCookieWriter } from './auth-cookie.writer';
import {
  CompleteAuthBodyDto,
  CompleteAuthResponseDto,
  CurrentUserResponseDto,
} from './dto/auth-complete.dto';
import {
  RequestOtpBodyDto,
  RequestOtpResponseDto,
  VerifyOtpBodyDto,
  VerifyOtpResponseDto,
} from './dto/auth-otp.dto';
import { AuthSessionStatusResponseDto } from './dto/auth-session-status.dto';
import { AccessTokenService } from '../infrastructure/access-token.service';
import { extractAccessTokenFromRequest } from './access-token.extraction';
import { resolveOtpRequestSource } from './request-source';

const AUTH_CACHE_CONTROL = 'no-store';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly cookies: AuthCookieWriter;

  constructor(
    private readonly lifecycle: SessionLifecycleService,
    private readonly completion: CustomerAuthCompletionService,
    private readonly profiles: CustomerProfileService,
    private readonly accessTokens: AccessTokenService,
    private readonly otp: OtpService,
    config: ConfigService,
  ) {
    this.cookies = new AuthCookieWriter(config.getOrThrow<string>('NODE_ENV'));
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Auth_requestOtp',
    summary: 'Request a customer OTP challenge',
    description: [
      'Accepts a supported Iranian mobile phone input, normalizes it to canonical E.164,',
      'and creates a short-lived OTP challenge via the AUTH-05 subsystem.',
      'Responses are enumeration-safe: success shape and status do not reveal whether',
      'the phone already maps to a User. OTP codes are never returned in the body,',
      'including development mode. No authentication cookie or session is issued.',
      'Phone and trusted request-source rate limits / cooldowns apply; 429 responses',
      'include `Retry-After` and `error.details.retryAfterSeconds` when applicable.',
      'CSRF cookie semantics do not apply: this is a pre-authentication endpoint.',
    ].join(' '),
  })
  @ApiBody({ type: RequestOtpBodyDto })
  @ApiResponse({
    status: 200,
    description: 'OTP challenge created (or delivery queued via provider).',
    type: RequestOtpResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for OTP responses.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body (validation).',
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description:
      'Resend cooldown (`AUTH_OTP_COOLDOWN`) or request window (`AUTH_OTP_RATE_LIMITED`).',
    type: ApiErrorResponseDto,
    headers: {
      'Retry-After': {
        description: 'Seconds until another request may succeed.',
        schema: { type: 'integer', example: 60 },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'OTP delivery or Redis unavailable (`AUTH_OTP_DELIVERY_FAILED` / `AUTH_OTP_UNAVAILABLE`).',
    type: ApiErrorResponseDto,
  })
  async requestOtp(
    @Body() body: RequestOtpBodyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RequestOtpResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const result = await this.otp.requestOtp({
      phone: body.phone,
      source: resolveOtpRequestSource(request),
    });

    const now = Date.now();
    return {
      data: {
        challengeId: result.challengeId,
        expiresInSeconds: secondsUntil(result.expiresAt, now),
        resendAfterSeconds: secondsUntil(result.resendAvailableAt, now),
      },
    };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Auth_verifyOtp',
    summary: 'Verify an OTP challenge and mint a verification grant',
    description: [
      'Verifies `challengeId` + six-digit code against Redis-backed AUTH-05 state.',
      'On success, atomically consumes the challenge and mints a short-lived,',
      'single-use verification grant bound to canonical phone and purpose.',
      'Does not issue AuthSession, access, or refresh tokens.',
      'The grant id is the only client-visible handoff for AUTH-07+;',
      'canonical phone is not returned. Development OTP values are never echoed.',
      'CSRF cookie semantics do not apply: this is a pre-authentication endpoint.',
    ].join(' '),
  })
  @ApiBody({ type: VerifyOtpBodyDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified; verification grant issued.',
    type: VerifyOtpResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for OTP responses.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body (validation).',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: [
      'Invalid/expired/locked/already-used challenge',
      '(`AUTH_OTP_INVALID`, `AUTH_OTP_EXPIRED`, `AUTH_OTP_TOO_MANY_ATTEMPTS`, `AUTH_OTP_ALREADY_USED`).',
    ].join(' '),
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'OTP store unavailable (`AUTH_OTP_UNAVAILABLE`).',
    type: ApiErrorResponseDto,
  })
  async verifyOtp(
    @Body() body: VerifyOtpBodyDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VerifyOtpResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const result = await this.otp.verifyOtp({
      challengeId: body.challengeId,
      code: body.code,
    });

    return {
      data: {
        verificationGrantId: result.verificationGrantId,
        expiresInSeconds: secondsUntil(result.grantExpiresAt, Date.now()),
        purpose: result.purpose,
      },
    };
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Auth_complete',
    summary: 'Complete customer authentication after OTP verification',
    description: [
      'Consumes a single-use OTP verification grant and authenticates the customer.',
      'Existing active Users receive a new AuthSession (multi-device; prior sessions kept).',
      'Unknown phones create exactly one User (phone uniqueness) then issue a session.',
      'Canonical phone comes only from the grant; do not send phone in the body.',
      'Sets HttpOnly `eggship_at` / `eggship_rt` cookies; tokens are never returned in JSON.',
      'Pre-authentication endpoint: authenticated-cookie CSRF does not apply here.',
      'After cookies are set, future cookie-authenticated mutations still require CSRF',
      '(production blocker until the CSRF roadmap task lands).',
      'Pattern A: identity User is created without a separate registration form;',
      'business profile fields are deferred pending legacy evidence (MIG-01).',
    ].join(' '),
  })
  @ApiBody({ type: CompleteAuthBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Authenticated; auth cookies set.',
    type: CompleteAuthResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for Auth completion responses.',
        schema: { type: 'string', example: 'no-store' },
      },
      'Set-Cookie': {
        description: 'HttpOnly `eggship_at` and `eggship_rt` cookies.',
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
    description: [
      'Invalid, expired, or already-used verification grant',
      '(`AUTH_VERIFICATION_GRANT_INVALID`, `AUTH_VERIFICATION_GRANT_EXPIRED`,',
      '`AUTH_VERIFICATION_GRANT_USED`).',
    ].join(' '),
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Account disabled (`AUTH_ACCOUNT_DISABLED`).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Registration conflict (`AUTH_REGISTRATION_CONFLICT`).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'OTP/grant store unavailable (`AUTH_OTP_UNAVAILABLE`).',
    type: ApiErrorResponseDto,
  })
  async completeAuth(
    @Body() body: CompleteAuthBodyDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CompleteAuthResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const result = await this.completion.completeAuthentication(
      body.verificationGrantId,
    );

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
        isNewUser: result.isNewUser,
        profileComplete: result.profileComplete,
        user: { id: result.user.id },
      },
    };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiOperation({
    operationId: 'Auth_me',
    summary: 'Return the authenticated customer/store identity',
    description: [
      'Requires a valid access token (cookie or Bearer; conflicting values rejected).',
      'Loads the current User from the authenticated principal; inactive accounts are rejected.',
      'Customer subjects only: an authenticated non-customer subject is rejected with 403.',
      'Does not expose Prisma models, tokens, or session secrets.',
    ].join(' '),
  })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description: 'Current authenticated user profile.',
    type: CurrentUserResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Always no-store for Auth me responses.',
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
      'Account disabled (`AUTH_ACCOUNT_DISABLED`) or wrong subject type (`AUTH_FORBIDDEN`).',
    type: ApiErrorResponseDto,
  })
  async me(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentUserResponseDto> {
    response.setHeader('Cache-Control', AUTH_CACHE_CONTROL);

    const principal = getAuthenticatedPrincipal(request);
    if (principal === undefined) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }

    const profile = await this.profiles.getCurrentProfile(principal);
    return {
      data: {
        user: {
          id: profile.id,
          phone: profile.phone,
          isActive: profile.isActive,
          profileComplete: profile.profileComplete,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        },
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Auth_refresh',
    summary: 'Rotate refresh session and issue new auth cookies',
    description: [
      'Reads the HttpOnly `eggship_rt` refresh cookie, atomically rotates the refresh token,',
      'issues a new short-lived access token cookie (`eggship_at`), and returns a minimal status body.',
      'Refresh tokens are never accepted from query strings or returned in JSON.',
      'CSRF protection for cookie-authenticated browser clients is required before production exposure;',
      'this endpoint is designed so CSRF middleware can wrap it.',
    ].join(' '),
  })
  @ApiCookieAuth('refreshCookie')
  @ApiResponse({
    status: 200,
    description: 'Refresh succeeded; new auth cookies are set.',
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
      // Do not clear cookies on concurrent-race AUTH_INVALID_TOKEN — a sibling
      // tab may have just set the winning cookies on this shared jar.
      if (shouldClearAuthCookiesOnRefreshFailure(error)) {
        this.cookies.clearAuthCookies(response);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'Auth_logout',
    summary: 'Revoke the current session and clear auth cookies',
    description: [
      'Revokes the session bound to the current access token when present,',
      'clears `eggship_at` and `eggship_rt`, and is idempotent when already logged out.',
      'Short-lived access tokens may remain cryptographically valid until expiry;',
      'refresh continuation is stopped. CSRF middleware is required for browser production use.',
    ].join(' '),
  })
  @ApiResponse({
    status: 200,
    description: 'Cookies cleared; session revoked when identifiable.',
    type: AuthSessionStatusResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Authenticated non-customer subject, or a customer presenting a session it does not own (`AUTH_FORBIDDEN`). Cookies are still cleared.',
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
    operationId: 'Auth_logoutAll',
    summary: 'Revoke all sessions for the authenticated subject',
    description: [
      'Requires a valid access token (cookie or Bearer).',
      'Revokes every active session for that subject, clears current auth cookies,',
      'and prevents further refresh on those sessions.',
      'Customer sessions only: an authenticated non-customer subject is rejected with 403.',
      'Does not affect other users. CSRF middleware is required for browser production use.',
    ].join(' '),
  })
  @ApiCookieAuth('accessCookie')
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description: 'All sessions revoked for the subject; cookies cleared.',
    type: AuthSessionStatusResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token.',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Authenticated principal is not a customer subject (`AUTH_FORBIDDEN`).',
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

function secondsUntil(target: Date, nowUnixMs: number): number {
  return Math.max(0, Math.ceil((target.getTime() - nowUnixMs) / 1000));
}

/**
 * Only session-invalidating failures clear cookies. Authorization denial
 * (`AUTH_FORBIDDEN`) and lost-race token errors must leave a sibling tab's
 * freshly issued cookies intact.
 */
function shouldClearAuthCookiesOnRefreshFailure(error: unknown): boolean {
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
