import type { TransactionContext } from '../../../infrastructure/database/transaction';
import type {
  OutboxEventEnvelope,
  OutboxEventRecord,
} from '../domain/outbox-event';

/**
 * Application contract for durable event intent. The transaction is required
 * so callers cannot accidentally publish outside their business transaction.
 */
export abstract class OutboxPublisher {
  abstract publish(
    envelope: OutboxEventEnvelope,
    tx: TransactionContext,
  ): Promise<OutboxEventRecord>;
}
