import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';
import { publicMessageForCode } from '../../../common/http/error-contract';

export const MediaErrorCode = {
  UNSUPPORTED_TYPE: 'MEDIA_UNSUPPORTED_TYPE',
  FILE_TOO_LARGE: 'MEDIA_FILE_TOO_LARGE',
  BATCH_TOO_LARGE: 'MEDIA_BATCH_TOO_LARGE',
  TOO_MANY_FILES: 'MEDIA_TOO_MANY_FILES',
  NO_FILES: 'MEDIA_NO_FILES',
  UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED',
  NOT_FOUND: 'MEDIA_NOT_FOUND',
  DELETE_FAILED: 'MEDIA_DELETE_FAILED',
  REFERENCED: 'MEDIA_REFERENCED',
  DELIVERY_FAILED: 'MEDIA_DELIVERY_FAILED',
} as const;

export type MediaErrorCode =
  (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

export class MediaUnsupportedTypeError extends ApplicationError {
  constructor(message = 'This file type is not supported.') {
    super(MediaErrorCode.UNSUPPORTED_TYPE, message, HttpStatus.BAD_REQUEST);
    this.name = 'MediaUnsupportedTypeError';
  }
}

export class MediaFileTooLargeError extends ApplicationError {
  constructor(message = 'The file exceeds the maximum allowed size.') {
    super(MediaErrorCode.FILE_TOO_LARGE, message, HttpStatus.BAD_REQUEST);
    this.name = 'MediaFileTooLargeError';
  }
}

export class MediaBatchTooLargeError extends ApplicationError {
  constructor(message = 'The upload batch exceeds the maximum allowed size.') {
    super(MediaErrorCode.BATCH_TOO_LARGE, message, HttpStatus.BAD_REQUEST);
    this.name = 'MediaBatchTooLargeError';
  }
}

export class MediaTooManyFilesError extends ApplicationError {
  constructor(message = 'Too many files in this upload request.') {
    super(MediaErrorCode.TOO_MANY_FILES, message, HttpStatus.BAD_REQUEST);
    this.name = 'MediaTooManyFilesError';
  }
}

export class MediaNoFilesError extends ApplicationError {
  constructor(message = 'At least one file is required.') {
    super(MediaErrorCode.NO_FILES, message, HttpStatus.BAD_REQUEST);
    this.name = 'MediaNoFilesError';
  }
}

export class MediaUploadFailedError extends ApplicationError {
  constructor(message = 'The file could not be stored.') {
    super(
      MediaErrorCode.UPLOAD_FAILED,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.name = 'MediaUploadFailedError';
  }
}

export class MediaNotFoundError extends ApplicationError {
  constructor(message = 'Media not found.') {
    super(MediaErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'MediaNotFoundError';
  }
}

export class MediaDeleteFailedError extends ApplicationError {
  constructor(message = 'Media could not be deleted.') {
    super(
      MediaErrorCode.DELETE_FAILED,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.name = 'MediaDeleteFailedError';
  }
}

export class MediaReferencedError extends ApplicationError {
  constructor(message = 'Media is referenced and cannot be deleted.') {
    super(MediaErrorCode.REFERENCED, message, HttpStatus.CONFLICT);
    this.name = 'MediaReferencedError';
  }
}

export class MediaDeliveryFailedError extends ApplicationError {
  constructor() {
    super(
      MediaErrorCode.DELIVERY_FAILED,
      'Media could not be delivered.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export function mediaErrorBody(error: ApplicationError): {
  code: string;
  message: string;
} {
  return {
    code: error.code,
    message: publicMessageForCode(error.code, error.httpStatus, error.message),
  };
}
