import { Injectable } from '@nestjs/common';
import { ApplicationLogger } from '../../common/observability/application-logger.service';
import { PrismaService } from '../database/prisma/prisma.service';

export interface QueueFailureMetadata {
  queueName: string;
  jobName: string;
  jobId?: string;
  attemptsMade: number;
  correlationId: string;
  outboxEventId?: string;
  eventType?: string;
  eventVersion?: number;
  processorIdentity?: string;
  category?: string;
  reasonCode?: string;
}

@Injectable()
export class QueueFailureReporter {
  constructor(
    private readonly logger: ApplicationLogger,
    private readonly prisma?: PrismaService,
  ) {}

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
    if (
      this.prisma &&
      metadata.outboxEventId &&
      metadata.eventType &&
      metadata.eventVersion &&
      metadata.processorIdentity
    ) {
      void this.prisma.asyncFailure
        .upsert({
          where: {
            outboxEventId_processorIdentity: {
              outboxEventId: metadata.outboxEventId,
              processorIdentity: metadata.processorIdentity,
            },
          },
          create: {
            outboxEventId: metadata.outboxEventId,
            processorIdentity: metadata.processorIdentity,
            queueName: metadata.queueName,
            jobName: metadata.jobName,
            jobId: metadata.jobId,
            eventType: metadata.eventType,
            eventVersion: metadata.eventVersion,
            correlationId: metadata.correlationId,
            attemptCount: metadata.attemptsMade,
            lastAttemptAt: new Date(),
            category: 'UNKNOWN',
            reasonCode: metadata.reasonCode ?? 'processor_failed',
          },
          update: {
            attemptCount: metadata.attemptsMade,
            lastAttemptAt: new Date(),
            reasonCode: metadata.reasonCode ?? 'processor_failed',
          },
        })
        .catch((persistenceError: unknown) =>
          this.logger.error(
            {
              module: 'queue',
              operation: 'failure_persistence_failed',
              outboxEventId: metadata.outboxEventId,
            },
            'Async failure persistence failed',
            persistenceError instanceof Error ? persistenceError : undefined,
          ),
        );
    }
  }
}
