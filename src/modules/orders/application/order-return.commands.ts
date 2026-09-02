import type { OrderAdminActor } from '../domain/order-actor';
import type {
  OrderReturnLineInput,
  OrderReturnRecord,
} from '../domain/order-return';

export interface RecordOrderReturnCommand {
  orderId: string;
  idempotencyKey: string;
  reason: string;
  lines: readonly OrderReturnLineInput[];
  actor: OrderAdminActor;
}

export interface RecordOrderReturnResult {
  orderReturn: OrderReturnRecord;
  replay: boolean;
}
