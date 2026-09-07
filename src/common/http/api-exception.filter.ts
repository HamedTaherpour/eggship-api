import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import { ApplicationError } from '../errors/application-error';
import { ApplicationLogger } from '../observability/application-logger.service';
import { RequestContextService } from '../observability/request-context.service';
import { createRequestId } from '../observability/request-id';
import { normalizeException } from './error-contract';

import type { ErrorResponseBody } from './error-contract';

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly context: RequestContextService,
    private readonly logger: ApplicationLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof AuthError
        ? statusForAuthError(exception.code)
        : exception instanceof ApplicationError
          ? exception.httpStatus
          : exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = this.context.getRequestId() ?? createRequestId();
    const correlationId = this.context.getCorrelationId() ?? requestId;
    const body: ErrorResponseBody = {
      error: normalizeException(exception, status),
      requestId,
    };

    if (status >= 500) {
      this.logger.error(
        {
          module: 'http',
          operation: 'exception',
          statusCode: status,
          errorCode: body.error.code,
          errorKind: 'unexpected',
          requestId,
          correlationId,
        },
        'Unexpected request failure',
        exception instanceof Error
          ? exception
          : new Error('A non-Error value was thrown.'),
      );
    } else {
      this.logger.info(
        {
          module: 'http',
          operation: 'request_error',
          statusCode: status,
          errorCode: body.error.code,
          errorKind: 'expected',
          requestId,
          correlationId,
        },
        'Request rejected',
      );
    }

    response.setHeader('x-request-id', requestId);

    if (
      exception instanceof AuthError &&
      (exception.code === AuthErrorCode.COOLDOWN ||
        exception.code === AuthErrorCode.RATE_LIMITED ||
        exception.code === AuthErrorCode.LOGIN_RATE_LIMITED)
    ) {
      const retryAfter = exception.details['retryAfterSeconds'];
      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
        response.setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil(retryAfter))),
        );
      }
    }

    response.status(status).json(body);
  }
}

function statusForAuthError(code: AuthErrorCode): number {
  switch (code) {
    case AuthErrorCode.ACCOUNT_DISABLED:
    case AuthErrorCode.FORBIDDEN:
      return HttpStatus.FORBIDDEN;
    case AuthErrorCode.REGISTRATION_CONFLICT:
      return HttpStatus.CONFLICT;
    case AuthErrorCode.COOLDOWN:
    case AuthErrorCode.RATE_LIMITED:
    case AuthErrorCode.LOGIN_RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    case AuthErrorCode.DELIVERY_FAILED:
    case AuthErrorCode.UNAVAILABLE:
    case AuthErrorCode.AUTH_UNAVAILABLE:
      return HttpStatus.SERVICE_UNAVAILABLE;
    case AuthErrorCode.INVALID:
    case AuthErrorCode.EXPIRED:
    case AuthErrorCode.TOO_MANY_ATTEMPTS:
    case AuthErrorCode.ALREADY_USED:
    case AuthErrorCode.VERIFICATION_GRANT_INVALID:
    case AuthErrorCode.VERIFICATION_GRANT_EXPIRED:
    case AuthErrorCode.VERIFICATION_GRANT_USED:
      return HttpStatus.UNAUTHORIZED;
    case AuthErrorCode.INVALID_CREDENTIALS:
    case AuthErrorCode.SESSION_EXPIRED:
    case AuthErrorCode.SESSION_REVOKED:
    case AuthErrorCode.REFRESH_TOKEN_REUSED:
    case AuthErrorCode.REFRESH_TOKEN_MISSING:
    case AuthErrorCode.INVALID_TOKEN:
    case AuthErrorCode.TOKEN_EXPIRED:
    case AuthErrorCode.UNAUTHENTICATED:
      return HttpStatus.UNAUTHORIZED;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
