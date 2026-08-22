import { assertInventoryUuid } from '../../inventory/domain/inventory-quantity';

export const PriceHistoryActorType = {
  ADMIN: 'ADMIN',
} as const;

export type PriceHistoryActorType =
  (typeof PriceHistoryActorType)[keyof typeof PriceHistoryActorType];

export interface PriceHistoryActor {
  type: typeof PriceHistoryActorType.ADMIN;
  id: string;
}

export function assertPriceHistoryActor(
  actor: PriceHistoryActor,
): PriceHistoryActor {
  if (actor.type !== PriceHistoryActorType.ADMIN) {
    throw new Error('Price history actor type is invalid.');
  }
  return {
    type: PriceHistoryActorType.ADMIN,
    id: assertInventoryUuid(actor.id, 'actorId'),
  };
}
