import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { ApplicationError } from '../../../common/errors/application-error';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { RequestContextService } from '../../../common/observability/request-context.service';
import { createRequestId } from '../../../common/observability/request-id';
import {
  MediaBatchTooLargeError,
  MediaFileTooLargeError,
  MediaTooManyFilesError,
} from '../domain/media-errors';

/**
 * Maps multer/Nest multipart hard-limit failures to stable Media error codes.
 * Nest's FilesInterceptor converts MulterError into HttpException before
 * filters run, so both shapes must be handled. These are request-level 4xx
 * outcomes (payload protection), not per-file results.
 */
@Catch(MulterError, PayloadTooLargeException, BadRequestException)
export class MediaUploadExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly context: RequestContextService,
    private readonly logger: ApplicationLogger,
  ) {}

  catch(
    exception: MulterError | PayloadTooLargeException | BadRequestException,
    host: ArgumentsHost,
  ): void {
    const mapped =
      mapUploadTransportError(exception) ??
      new MediaTooManyFilesError('The upload request is invalid.');
    const requestId = this.context.getRequestId() ?? createRequestId();
    const response = host.switchToHttp().getResponse<Response>();

    this.logger.info(
      {
        module: 'media',
        operation: 'media.upload.failed',
        errorCode: mapped.code,
        statusCode: mapped.httpStatus,
      },
      'Media multipart request rejected',
    );

    response.setHeader('x-request-id', requestId);
    response.status(mapped.httpStatus).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        details: {},
      },
      requestId,
    });
  }
}

export function mapUploadTransportError(
  error: unknown,
): ApplicationError | null {
  if (error instanceof MediaBatchTooLargeError) {
    return error;
  }
  if (error instanceof MulterError) {
    return mapMulterError(error);
  }
  if (error instanceof PayloadTooLargeException) {
    return new MediaFileTooLargeError();
  }
  if (error instanceof BadRequestException) {
    return mapBadRequestMessage(httpExceptionMessage(error));
  }
  return null;
}

function mapMulterError(error: MulterError): ApplicationError {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new MediaFileTooLargeError();
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT') {
    return new MediaTooManyFilesError();
  }
  return new MediaTooManyFilesError('The upload request is invalid.');
}

function mapBadRequestMessage(message: string): ApplicationError {
  if (message.startsWith('File too large')) {
    return new MediaFileTooLargeError();
  }
  if (
    message.startsWith('Too many files') ||
    message.startsWith('Too many parts')
  ) {
    return new MediaTooManyFilesError();
  }
  return new MediaTooManyFilesError('The upload request is invalid.');
}

function httpExceptionMessage(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  if (isRecord(body) && 'message' in body) {
    const message = body['message'];
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message) && typeof message[0] === 'string') {
      return message[0];
    }
  }
  return error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
