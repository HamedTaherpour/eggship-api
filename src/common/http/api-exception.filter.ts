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

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  requestId: string;
}

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
    const body = this.buildBody(exception, status, requestId);

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

  private buildBody(
    exception: unknown,
    status: number,
    requestId: string,
  ): ErrorBody {
    if (exception instanceof AuthError) {
      return {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
        requestId,
      };
    }

    if (exception instanceof ApplicationError) {
      return {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
        requestId,
      };
    }

    if (!(exception instanceof HttpException)) {
      return this.internalErrorBody(requestId);
    }

    if (status >= 500) {
      return this.internalErrorBody(requestId);
    }

    const exceptionResponse: unknown = exception.getResponse();
    const details = this.extractDetails(exceptionResponse);

    return {
      error: {
        code: this.extractCode(exceptionResponse, status),
        message: this.extractMessage(exceptionResponse, exception.message),
        details,
      },
      requestId,
    };
  }

  private internalErrorBody(requestId: string): ErrorBody {
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
      },
      requestId,
    };
  }

  private extractCode(response: unknown, status: number): string {
    if (this.isRecord(response) && typeof response['code'] === 'string') {
      const code = response['code'].trim();
      if (code !== '') {
        return code;
      }
    }
    return this.codeForStatus(status);
  }

  private extractMessage(response: unknown, fallback: string): string {
    if (typeof response === 'string') {
      return response;
    }
    if (this.isRecord(response)) {
      const message = response['message'];
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return 'Request validation failed.';
      }
    }
    return fallback;
  }

  private extractDetails(response: unknown): Record<string, unknown> {
    if (this.isRecord(response) && Array.isArray(response['message'])) {
      return { violations: response['message'] };
    }
    return {};
  }

  private codeForStatus(status: number): string {
    const knownCodes: Partial<Record<number, string>> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
    };
    return knownCodes[status] ?? 'HTTP_ERROR';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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
