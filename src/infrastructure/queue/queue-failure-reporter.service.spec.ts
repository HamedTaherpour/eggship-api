import { PassThrough } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { RequestContextService } from '../../common/observability/request-context.service';
import { QueueFailureReporter } from './queue-failure-reporter.service';

describe('QueueFailureReporter', () => {
  it('emits inspectable structured metadata with sensitive failure text redacted', () => {
    const destination = new PassThrough();
    let output = '';
    destination.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const logger = new ApplicationLogger(
      new ConfigService({
        NODE_ENV: 'test',
        APP_VERSION: '0.1.0-test',
        GIT_SHA: 'test',
      }),
      new RequestContextService(),
      destination,
    );
    const reporter = new QueueFailureReporter(logger);

    reporter.report(
      {
        queueName: 'test-queue',
        jobName: 'test-job',
        jobId: 'job-1',
        attemptsMade: 3,
        correlationId: 'corr-1',
      },
      new Error('access_token=private-token'),
    );

    const record: unknown = JSON.parse(output.trim());
    expect(record).toMatchObject({
      module: 'queue',
      operation: 'job_failed',
      queueName: 'test-queue',
      jobName: 'test-job',
      jobId: 'job-1',
      attemptsMade: 3,
      failureReason: 'access_token=[REDACTED]',
      correlationId: 'corr-1',
      msg: 'Async job failed',
    });
    expect(record).toHaveProperty('failedAt');
    expect(output).not.toContain('private-token');
  });
});
