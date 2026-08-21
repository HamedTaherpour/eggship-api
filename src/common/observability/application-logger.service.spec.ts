import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from './application-logger.service';
import { RequestContextService } from './request-context.service';

describe('ApplicationLogger', () => {
  it('writes structured metadata, context, and centrally redacted fields', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const context = new RequestContextService();
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'development',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'abc123',
      }),
      context,
      destination,
    );

    context.run({ requestId: 'req_logger', correlationId: 'req_logger' }, () =>
      logger.info(
        {
          module: 'test',
          operation: 'redaction',
          headers: {
            authorization: 'Bearer access-secret',
            cookie: 'session=secret',
          },
          credentials: {
            password: 'password-secret',
            clientSecret: 'client-secret',
            databaseUrl: 'postgresql://user:password@database/eggship',
          },
          email: 'person@example.com',
          shippingAddress: 'private address',
        },
        'Completed with access_token=token-secret',
      ),
    );

    const record: unknown = JSON.parse(output.trim());
    expect(record).toMatchObject({
      level: 'info',
      service: 'eggship-api',
      environment: 'development',
      version: '0.1.0-test',
      gitSha: 'abc123',
      requestId: 'req_logger',
      correlationId: 'req_logger',
      module: 'test',
      operation: 'redaction',
      headers: {
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
      },
      credentials: {
        password: '[REDACTED]',
        clientSecret: '[REDACTED]',
        databaseUrl: '[REDACTED]',
      },
      email: '[REDACTED]',
      shippingAddress: '[REDACTED]',
      msg: 'Completed with access_token=[REDACTED]',
    });
    expect(output).not.toContain('access-secret');
    expect(output).not.toContain('password-secret');
    expect(output).not.toContain('person@example.com');
    expect(output).not.toContain('private address');
  });

  it('redacts sensitive values from internally logged error stacks', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'development',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'abc123',
      }),
      new RequestContextService(),
      destination,
    );

    logger.error(
      { module: 'database', operation: 'connect' },
      'Database operation failed',
      new Error('postgresql://user:password@database/eggship'),
    );

    expect(output).toContain('postgresql://[REDACTED]@database/eggship');
    expect(output).not.toContain('user:password');
  });

  it('redacts Redis credentials from internally logged errors', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'development',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'abc123',
      }),
      new RequestContextService(),
      destination,
    );

    logger.error(
      { module: 'redis', operation: 'connect' },
      'Redis operation failed',
      new Error('rediss://user:private-password@redis.example.invalid:6380'),
    );

    expect(output).toContain('rediss://[REDACTED]@redis.example.invalid:6380');
    expect(output).not.toContain('private-password');
  });
});
