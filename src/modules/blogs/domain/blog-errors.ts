import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error';

export const BlogErrorCode = {
  NOT_FOUND: 'BLOG_NOT_FOUND',
  INVALID_SLUG: 'BLOG_INVALID_SLUG',
  INVALID_TITLE: 'BLOG_INVALID_TITLE',
  INVALID_BODY: 'BLOG_INVALID_BODY',
  SLUG_CONFLICT: 'BLOG_SLUG_CONFLICT',
  INVALID_PUBLICATION: 'BLOG_INVALID_PUBLICATION',
  INVALID_FIELD: 'BLOG_INVALID_FIELD',
  AUTHOR_NOT_FOUND: 'BLOG_AUTHOR_NOT_FOUND',
  AUTHOR_INACTIVE: 'BLOG_AUTHOR_INACTIVE',
  CATEGORY_NOT_FOUND: 'BLOG_CATEGORY_NOT_FOUND',
  TAG_NOT_FOUND: 'BLOG_TAG_NOT_FOUND',
  TAXONOMY_CONFLICT: 'BLOG_TAXONOMY_CONFLICT',
  REFERENCED_DELETE: 'BLOG_REFERENCED_DELETE',
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

export class BlogInvalidFieldError extends ApplicationError {
  constructor(message = 'Blog field is invalid.') {
    super(BlogErrorCode.INVALID_FIELD, message, HttpStatus.BAD_REQUEST);
    this.name = 'BlogInvalidFieldError';
  }
}
export class BlogAuthorNotFoundError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.AUTHOR_NOT_FOUND,
      'Blog author not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
export class BlogAuthorInactiveError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.AUTHOR_INACTIVE,
      'Blog author must be active to publish.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
export class BlogCategoryNotFoundError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.CATEGORY_NOT_FOUND,
      'Blog category not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
export class BlogTagNotFoundError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.TAG_NOT_FOUND,
      'Blog tag not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
export class BlogTaxonomyConflictError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.TAXONOMY_CONFLICT,
      'Blog taxonomy slug is already in use.',
      HttpStatus.CONFLICT,
    );
  }
}
export class BlogReferencedDeleteError extends ApplicationError {
  constructor() {
    super(
      BlogErrorCode.REFERENCED_DELETE,
      'Referenced Blog taxonomy cannot be deleted.',
      HttpStatus.CONFLICT,
    );
  }
}
