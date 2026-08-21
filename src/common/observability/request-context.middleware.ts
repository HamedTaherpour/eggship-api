import { performance } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApplicationLogger } from './application-logger.service';
import { RequestContextService } from './request-context.service';
import { resolveRequestId } from './request-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: RequestContextService,
    private readonly logger: ApplicationLogger,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.header('x-request-id'));
    const correlationId = requestId;
    const startedAt = performance.now();

    response.setHeader('X-Request-Id', requestId);
    this.context.run({ requestId, correlationId }, () => {
      response.once('finish', () => {
        this.logger.info(
          {
            module: 'http',
            operation: 'request',
            method: request.method,
            path: request.path,
            statusCode: response.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          },
          'Request completed',
        );
      });
      next();
    });
  }
}
