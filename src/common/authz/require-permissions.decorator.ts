import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Permission } from './permission';

export const REQUIRED_PERMISSIONS_METADATA_KEY = 'eggship:requiredPermissions';

/**
 * Declares the permissions a route requires. Semantics are **ALL** — the
 * principal must hold every listed permission, and controller-level plus
 * handler-level declarations are unioned into one required set.
 *
 * At least one permission is required by the type signature; an empty
 * requirement is denied at runtime as well.
 *
 * Use together with the authenticating guard, for example
 * `@UseGuards(AccessTokenGuard, PermissionGuard)`.
 */
export function RequirePermissions(
  ...permissions: readonly [Permission, ...Permission[]]
): CustomDecorator<string> {
  return SetMetadata(REQUIRED_PERMISSIONS_METADATA_KEY, [...permissions]);
}

/**
 * Reads declared permissions from handler and controller metadata. Values are
 * returned untrusted; `AuthorizationService` validates them and fails closed.
 */
export function readRequiredPermissions(
  reflector: Reflector,
  context: ExecutionContext,
): readonly unknown[] {
  return reflector.getAllAndMerge<unknown[]>(
    REQUIRED_PERMISSIONS_METADATA_KEY,
    [context.getHandler(), context.getClass()],
  );
}
