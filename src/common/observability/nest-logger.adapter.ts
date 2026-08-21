import { Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ApplicationLogger } from './application-logger.service';

@Injectable()
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: ApplicationLogger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(this.fields(optionalParams), this.message(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(
      { ...this.fields(optionalParams), severity: 'fatal' },
      this.message(message),
      this.errorFrom(message, optionalParams),
    );
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(
      this.fields(optionalParams),
      this.message(message),
      this.errorFrom(message, optionalParams),
    );
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(this.fields(optionalParams), this.message(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(this.fields(optionalParams), this.message(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(
      { ...this.fields(optionalParams), verbosity: 'verbose' },
      this.message(message),
    );
  }

  private fields(optionalParams: unknown[]): {
    module: string;
    operation: string;
  } {
    const possibleContext = optionalParams.findLast(
      (value) =>
        typeof value === 'string' &&
        value.length <= 128 &&
        !value.includes('\n'),
    );
    return {
      module: typeof possibleContext === 'string' ? possibleContext : 'nest',
      operation: 'framework',
    };
  }

  private message(value: unknown): string {
    if (value instanceof Error) {
      return value.message;
    }
    return typeof value === 'string' ? value : String(value);
  }

  private errorFrom(
    message: unknown,
    optionalParams: unknown[],
  ): Error | undefined {
    if (message instanceof Error) {
      return message;
    }
    const stack = optionalParams.find(
      (value): value is string =>
        typeof value === 'string' && value.includes('\n'),
    );
    if (stack === undefined) {
      return undefined;
    }
    const error = new Error(this.message(message));
    error.stack = stack;
    return error;
  }
}
