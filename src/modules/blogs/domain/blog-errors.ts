import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const BlogErrorCode = {
  NOT_FOUND: 'BLOG_NOT_FOUND',
  INVALID_SLUG: 'BLOG_INVALID_SLUG',
  INVALID_TITLE: 'BLOG_INVALID_TITLE',
  INVALID_BODY: 'BLOG_INVALID_BODY',
  SLUG_CONFLICT: 'BLOG_SLUG_CONFLICT',
  INVALID_PUBLICATION: 'BLOG_INVALID_PUBLICATION',
} as const;

export type BlogErrorCode = (typeof BlogErrorCode)[keyof typeof BlogErrorCode];

export class BlogNotFoundError extends ApplicationError {
  constructor(message = 'Blog not found.') {
    super(BlogErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
    this.name = 'BlogNotFoundError';
  }
}

export class BlogInvalidSlugError extends ApplicationError {
  constructor(message = 'Blog slug is invalid.') {
    super(BlogErrorCode.INVALID_SLUG, message, HttpStatus.BAD_REQUEST);
    this.name = 'BlogInvalidSlugError';
  }
}

export class BlogInvalidTitleError extends ApplicationError {
  constructor(message = 'Blog title is invalid.') {
    super(BlogErrorCode.INVALID_TITLE, message, HttpStatus.BAD_REQUEST);
    this.name = 'BlogInvalidTitleError';
  }
}

export class BlogInvalidBodyError extends ApplicationError {
  constructor(message = 'Blog body is invalid.') {
    super(BlogErrorCode.INVALID_BODY, message, HttpStatus.BAD_REQUEST);
    this.name = 'BlogInvalidBodyError';
  }
}

export class BlogSlugConflictError extends ApplicationError {
  constructor(message = 'Blog slug is already in use.') {
    super(BlogErrorCode.SLUG_CONFLICT, message, HttpStatus.CONFLICT);
    this.name = 'BlogSlugConflictError';
  }
}

export class BlogInvalidPublicationError extends ApplicationError {
  constructor(message = 'Blog publication state is invalid.') {
    super(BlogErrorCode.INVALID_PUBLICATION, message, HttpStatus.BAD_REQUEST);
    this.name = 'BlogInvalidPublicationError';
  }
}
