import type { PriceHistoryActorType } from './price-history-actor';

export interface PriceHistoryRecord {
  id: string;
  productId: string;
  oldPrice: number;
  newPrice: number;
  actorType: PriceHistoryActorType;
  actorId: string;
  createdAt: Date;
}

export interface AppendPriceHistoryInput {
  productId: string;
  oldPrice: number;
  newPrice: number;
  actorType: PriceHistoryActorType;
  actorId: string;
}
