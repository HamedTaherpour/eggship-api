import { OrderInvalidInputError } from './order-errors';
import { OrderMessage } from './order-messages';
import { assertOrderUuid } from './order-snapshot';

/**
 * Persistence-neutral actor for Order transition commands.
 * HTTP authorization remains ORD-05/ORD-06; this is trusted caller context.
 */
export const OrderActorType = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export type OrderActorType =
  (typeof OrderActorType)[keyof typeof OrderActorType];

export interface OrderUserActor {
  type: typeof OrderActorType.USER;
  id: string;
}

export interface OrderAdminActor {
  type: typeof OrderActorType.ADMIN;
  id: string;
}

export type OrderActor = OrderUserActor | OrderAdminActor;

export function assertAdminActor(actor: OrderActor): OrderAdminActor {
  if (actor.type !== OrderActorType.ADMIN) {
    throw new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
  }
  return {
    type: OrderActorType.ADMIN,
    id: assertOrderUuid(actor.id, 'actorId'),
  };
}

export function assertUserActor(actor: OrderActor): OrderUserActor {
  if (actor.type !== OrderActorType.USER) {
    throw new OrderInvalidInputError(OrderMessage.INVALID_INPUT);
  }
  return {
    type: OrderActorType.USER,
    id: assertOrderUuid(actor.id, 'actorId'),
  };
}
