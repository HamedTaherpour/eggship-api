import { Prisma } from '../../../generated/prisma/client';
import { ApplicationError } from '../../../common/errors/application-error';
import {
  InventoryInvalidAdjustmentError,
  InventoryNotFoundError,
  InventoryReservationConflictError,
} from '../domain/inventory-errors';

function isPrismaKnown(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function collectErrorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '';
  }
  const parts: string[] = [];
  if ('code' in error && typeof error.code === 'string') {
    parts.push(error.code);
  }
  if ('message' in error && typeof error.message === 'string') {
    parts.push(error.message);
  }
  if (
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null
  ) {
    parts.push(JSON.stringify(error.meta));
  }
  const cause = 'cause' in error ? error.cause : undefined;
  if (cause !== undefined) {
    parts.push(collectErrorText(cause));
  }
  return parts.join(' ');
}

function driverSqlState(error: unknown): string | undefined {
  const text = collectErrorText(error);
  const match = /\b(23505|23503|23514|22003)\b/u.exec(text);
  return match?.[1];
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (isPrismaKnown(error) && error.code === 'P2002') {
    return true;
  }
  return driverSqlState(error) === '23505';
}

export function isForeignKeyError(error: unknown): boolean {
  if (isPrismaKnown(error) && error.code === 'P2003') {
    return true;
  }
  return driverSqlState(error) === '23503';
}

export function translateInventoryPersistenceError(error: unknown): never {
  if (error instanceof ApplicationError) {
    throw error;
  }
  if (isUniqueConstraintError(error)) {
    throw new InventoryReservationConflictError(
      'This inventory event was already recorded.',
    );
  }
  if (isForeignKeyError(error)) {
    throw new InventoryNotFoundError('Product does not exist.');
  }
  const sqlState = driverSqlState(error);
  if (sqlState === '23514' || sqlState === '22003') {
    throw new InventoryInvalidAdjustmentError(
      'This inventory change would violate stock limits.',
    );
  }
  throw error;
}
