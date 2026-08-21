import { HttpStatus } from '@nestjs/common';

/**
 * Domain/application failure with a stable client-visible code and HTTP status.
 * Mapped at the API boundary by `ApiExceptionFilter` (same envelope as AuthError).
 *
 * Prefer module-specific typed constructors that set a fixed `code` rather than
 * throwing bare strings. Do not leak Prisma or infrastructure error codes.
 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: number = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
