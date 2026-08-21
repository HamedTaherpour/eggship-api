import { Injectable } from '@nestjs/common';
import { ApplicationLogger } from '../../common/observability/application-logger.service';

export interface QueueFailureMetadata {
  queueName: string;
  jobName: string;
  jobId?: string;
  attemptsMade: number;
  correlationId: string;
}

@Injectable()
export class QueueFailureReporter {
  constructor(private readonly logger: ApplicationLogger) {}

  report(metadata: QueueFailureMetadata, error: Error): void {
    this.logger.error(
      {
        module: 'queue',
        operation: 'job_failed',
        queueName: metadata.queueName,
        jobName: metadata.jobName,
        jobId: metadata.jobId,
        attemptsMade: metadata.attemptsMade,
        failureReason: error.message,
        correlationId: metadata.correlationId,
        failedAt: new Date().toISOString(),
      },
      'Async job failed',
      error,
    );
  }
}
