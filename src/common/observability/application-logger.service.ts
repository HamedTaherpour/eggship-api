import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import {
  redactLogFields,
  redactSensitiveText,
  sanitizeError,
} from './log-redaction';
import { RequestContextService } from './request-context.service';

export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

export interface LogFields {
  [key: string]: unknown;
  module: string;
  operation: string;
}

@Injectable()
export class ApplicationLogger {
  private readonly logger: Logger;

  constructor(
    config: ConfigService,
    private readonly context: RequestContextService,
    @Inject(LOG_DESTINATION)
    destination: DestinationStream,
  ) {
    const options: pino.LoggerOptions = {
      level: this.logLevel(config.getOrThrow<string>('NODE_ENV')),
      base: {
        service: 'eggship-api',
        environment: config.getOrThrow<string>('NODE_ENV'),
        version: config.getOrThrow<string>('APP_VERSION'),
        gitSha: config.getOrThrow<string>('GIT_SHA'),
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };
    this.logger = pino(options, destination);
  }

  debug(fields: LogFields, message: string): void {
    this.write('debug', fields, message);
  }

  info(fields: LogFields, message: string): void {
    this.write('info', fields, message);
  }

  warn(fields: LogFields, message: string): void {
    this.write('warn', fields, message);
  }

  error(fields: LogFields, message: string, error?: Error): void {
    this.write(
      'error',
      error === undefined ? fields : { ...fields, err: sanitizeError(error) },
      message,
    );
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error',
    fields: LogFields,
    message: string,
  ): void {
    const requestContext = this.context.get();
    const safeFields = redactLogFields({ ...fields, ...requestContext });
    this.logger[level](safeFields, redactSensitiveText(message));
  }

  private logLevel(environment: string): string {
    return environment === 'production' ? 'info' : 'debug';
  }
}
