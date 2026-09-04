import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import type { WorkerProcessor } from '../../../infrastructure/worker/worker.types';
import type {
  RecoveryProcessor,
  ReplayExecutionResult,
} from '../../async-recovery/domain/async-recovery';
import { classifyProcessorFailure } from '../../async-recovery/domain/async-recovery';
import { NotificationType } from '../domain/notification';
import {
  PUSH_DELIVERY_PROVIDER,
  PushDeliveryFailureCode,
  type PushDeliveryMessage,
  type PushDeliveryProvider,
} from '../domain/push-delivery-provider';
import { NotificationDeliveryRepository } from '../infrastructure/notification-delivery.repository';
import { NotificationRepository } from '../infrastructure/notification.repository';
import { PushInstallationRepository } from '../infrastructure/push-installation.repository';
import type { AsyncJobEnvelope } from '../../../infrastructure/queue/async-job-context.service';
import type { AsyncRecoveryService } from '../../async-recovery/application/async-recovery.service';

export const ORDER_STATUS_PROCESSOR_IDENTITY = 'notifications.order-status.v1';
const EVENT_TYPE = 'order.status.changed';
const EVENT_VERSION = 1;

type EventData = {
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  replayId?: string;
};

@Injectable()
export class OrderStatusNotificationProcessor
  implements WorkerProcessor, RecoveryProcessor
{
  readonly identity = ORDER_STATUS_PROCESSOR_IDENTITY;
  readonly queueName = 'outbox-events';
  readonly jobName = EVENT_TYPE;
  readonly eventType = EVENT_TYPE;
  readonly eventVersion = EVENT_VERSION;
  readonly replaySafe = true;
  readonly idempotencyDescription =
    'PostgreSQL materialized recipient set and per-delivery claim token.';

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly installations: PushInstallationRepository,
    @Inject(PUSH_DELIVERY_PROVIDER)
    private readonly provider: PushDeliveryProvider,
    private readonly recovery: AsyncRecoveryService,
    private readonly config: ConfigService,
  ) {}

  async process(job: Job<AsyncJobEnvelope<unknown>>): Promise<void> {
    const data = this.parse(job.data?.data);
    if (data === undefined)
      throw permanent('invalid_processor_envelope', 'INVALID_PAYLOAD');
    if (data.replayId !== undefined) {
      const claimed = await this.recovery.beginReplayExecution(data.replayId);
      if (!claimed) return;
      try {
        await this.execute(data);
        await this.recovery.recordReplayResult(data.replayId, {
          outcome: 'SUCCEEDED',
          attemptedAt: new Date(),
          processorIdentity: this.identity,
          releaseIdentity: this.releaseIdentity(),
        });
      } catch (error: unknown) {
        await this.recovery.recordReplayResult(data.replayId, {
          outcome: 'FAILED',
          attemptedAt: new Date(),
          processorIdentity: this.identity,
          releaseIdentity: this.releaseIdentity(),
          failure: classifyProcessorFailure(error),
        });
      }
      return;
    }
    await this.execute(data);
  }

  async executeReplay(input: {
    replayId: string;
    outboxEventId?: string;
    eventType: string;
    eventVersion: number;
    payload: Record<string, unknown>;
  }): Promise<ReplayExecutionResult> {
    await this.execute({
      outboxEventId: input.outboxEventId ?? input.replayId,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      occurredAt: new Date().toISOString(),
      payload: input.payload,
    });
    return {
      outcome: 'SUCCEEDED',
      attemptedAt: new Date(),
      processorIdentity: this.identity,
      releaseIdentity: this.releaseIdentity(),
    };
  }

  private async execute(data: EventData): Promise<void> {
    if (data.eventType !== EVENT_TYPE || data.eventVersion !== EVENT_VERSION)
      throw permanent('unsupported_version', 'UNSUPPORTED_VERSION');
    const orderId = this.stringField(data.payload, 'orderId');
    const status = this.stringField(data.payload, 'status');
    if (!isUuid(data.outboxEventId) || !isUuid(orderId))
      throw permanent('invalid_event_payload', 'INVALID_PAYLOAD');
    const notification = await this.notifications.findById(data.outboxEventId);
    if (
      !notification ||
      notification.type !== NotificationType.ORDER_STATUS ||
      notification.payload.orderId !== orderId ||
      notification.payload.status !== status
    )
      throw permanent('notification_contract_mismatch', 'BUSINESS_REJECTION');

    await this.deliveries.materializeOnce(notification.id, notification.userId);
    const candidates = await this.deliveries.findClaimable(notification.id);
    let retryable = false;
    let permanentCode: string | undefined;
    for (const candidate of candidates) {
      if (
        !candidate.userIsActive ||
        candidate.installationStatus !== 'ACTIVE' ||
        !candidate.permissionGranted
      ) {
        const suppressionClaim = await this.deliveries.claim(candidate.id);
        if (suppressionClaim)
          await this.deliveries.complete(
            candidate.id,
            suppressionClaim.claimToken,
            'SUPPRESSED',
          );
        continue;
      }
      const claim = await this.deliveries.claim(candidate.id);
      if (!claim) continue;
      if (!(await this.deliveries.isEligible(candidate.installationId))) {
        await this.deliveries.complete(
          candidate.id,
          claim.claimToken,
          'SUPPRESSED',
        );
        continue;
      }
      const message: PushDeliveryMessage = {
        notificationId: notification.id,
        installationId: candidate.installationId,
        title: notification.title,
        body: notification.body,
        metadata: { version: 1, destination: { type: 'ORDER', id: orderId } },
      };
      const result = await this.provider.send(candidate.providerToken, message);
      if (result.kind === 'accepted')
        await this.deliveries.complete(
          candidate.id,
          claim.claimToken,
          'ACCEPTED',
        );
      else if (result.code === PushDeliveryFailureCode.INVALID_TOKEN) {
        await this.installations.invalidate(candidate.installationId);
        await this.deliveries.complete(
          candidate.id,
          claim.claimToken,
          'INVALIDATED',
          'INVALID_TOKEN',
        );
      } else if (
        result.code === PushDeliveryFailureCode.TRANSIENT ||
        result.code === PushDeliveryFailureCode.RATE_LIMITED
      ) {
        retryable = true;
        await this.deliveries.complete(
          candidate.id,
          claim.claimToken,
          'FAILED',
          result.code,
        );
      } else {
        await this.deliveries.complete(
          candidate.id,
          claim.claimToken,
          'FAILED',
          result.code,
        );
        permanentCode = result.code;
      }
    }
    if (retryable)
      throw retryableFailure(
        'provider_retryable_failure',
        'PROVIDER_TRANSIENT',
      );
    if (permanentCode !== undefined)
      throw permanent('provider_permanent_failure', permanentCode);
  }

  private parse(value: unknown): EventData | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const data = value as Record<string, unknown>;
    if (
      typeof data.outboxEventId !== 'string' ||
      typeof data.eventType !== 'string' ||
      data.eventVersion !== EVENT_VERSION ||
      typeof data.payload !== 'object' ||
      data.payload === null ||
      Array.isArray(data.payload)
    )
      return undefined;
    return data as unknown as EventData;
  }
  private stringField(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || value.length === 0 || value.length > 128)
      throw permanent('invalid_event_payload', 'INVALID_PAYLOAD');
    return value;
  }
  private releaseIdentity(): string {
    return (
      this.config.get<string>('GIT_SHA') ??
      this.config.get<string>('APP_VERSION') ??
      'unknown'
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

type ProcessorError = Error & {
  category: string;
  reasonCode: string;
  retryable: boolean;
};
function permanent(reasonCode: string, category: string): ProcessorError {
  return Object.assign(new Error(reasonCode), {
    category,
    reasonCode,
    retryable: false,
  });
}
function retryableFailure(
  reasonCode: string,
  category: string,
): ProcessorError {
  return Object.assign(new Error(reasonCode), {
    category,
    reasonCode,
    retryable: true,
  });
}
