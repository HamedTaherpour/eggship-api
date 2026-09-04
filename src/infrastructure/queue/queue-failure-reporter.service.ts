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
        failureCategory: metadata.category ?? normalizedFailureCategory(error),
        failureCode: metadata.reasonCode ?? normalizedFailureReason(error),
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
            category: toAsyncFailureCategory(
              metadata.category ?? normalizedFailureCategory(error),
            ),
            reasonCode: metadata.reasonCode ?? normalizedFailureReason(error),
          },
          update: {
            attemptCount: metadata.attemptsMade,
            lastAttemptAt: new Date(),
            reasonCode: metadata.reasonCode ?? normalizedFailureReason(error),
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

function normalizedFailureCategory(error: Error): string {
  return isFailureMetadata(error) ? error.category : 'UNKNOWN';
}
function normalizedFailureReason(error: Error): string {
  return isFailureMetadata(error) ? error.reasonCode : 'processor_failed';
}
function isFailureMetadata(
  error: Error,
): error is Error & { category: string; reasonCode: string } {
  return (
    typeof (error as { category?: unknown }).category === 'string' &&
    typeof (error as { reasonCode?: unknown }).reasonCode === 'string'
  );
}
function toAsyncFailureCategory(
  value: string,
):
  | 'INFRASTRUCTURE_TRANSIENT'
  | 'PROVIDER_TRANSIENT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_PERMANENT'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_VERSION'
  | 'BUSINESS_REJECTION'
  | 'PROCESSOR_TIMEOUT'
  | 'UNKNOWN' {
  const allowed = [
    'INFRASTRUCTURE_TRANSIENT',
    'PROVIDER_TRANSIENT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_PERMANENT',
    'INVALID_PAYLOAD',
    'UNSUPPORTED_VERSION',
    'BUSINESS_REJECTION',
    'PROCESSOR_TIMEOUT',
    'UNKNOWN',
  ] as const;
  return (allowed as readonly string[]).includes(value)
    ? (value as ReturnType<typeof toAsyncFailureCategory>)
    : 'UNKNOWN';
}
