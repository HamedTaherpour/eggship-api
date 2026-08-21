import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from './prisma.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  type TransactionContext,
} from '../transaction';

const prismaClients = new WeakMap<
  PrismaTransactionContext,
  Prisma.TransactionClient
>();

/**
 * Prisma-backed transaction context. Application/domain code must treat this
 * as the opaque `TransactionContext` type only. The Prisma client is stored
 * off the instance so callers cannot unwrap `Prisma.TransactionClient`.
 */
export class PrismaTransactionContext implements TransactionContext {
  readonly [TRANSACTION_CONTEXT_BRAND] = true as const;

  constructor(client: Prisma.TransactionClient) {
    prismaClients.set(this, client);
  }
}

export type PrismaConnection = PrismaService | Prisma.TransactionClient;

export function resolvePrismaConnection(
  prisma: PrismaService,
  tx: TransactionContext | undefined,
): PrismaConnection {
  if (tx === undefined) {
    return prisma;
  }
  if (tx instanceof PrismaTransactionContext) {
    const client = prismaClients.get(tx);
    if (client === undefined) {
      throw new Error('Transaction context is invalid.');
    }
    return client;
  }
  throw new Error('Transaction context is invalid.');
}
