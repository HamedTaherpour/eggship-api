import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { isAdminRole, type AdminRole } from '../../../common/authz/admin-role';

export const AuditActorType = {
  ADMIN: 'ADMIN',
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  ANONYMOUS: 'ANONYMOUS',
} as const;
export type AuditActorType =
  (typeof AuditActorType)[keyof typeof AuditActorType];

export const AuditEntityType = {
  ADMIN: 'ADMIN',
  USER: 'USER',
  PRODUCT: 'PRODUCT',
  CATEGORY: 'CATEGORY',
  REGION: 'REGION',
  DISCOUNT: 'DISCOUNT',
  INVENTORY: 'INVENTORY',
  ORDER: 'ORDER',
  SETTLEMENT: 'SETTLEMENT',
  COMMERCE_POLICY: 'COMMERCE_POLICY',
  VISITOR: 'VISITOR',
  BLOG: 'BLOG',
  MEDIA: 'MEDIA',
  ASYNC_FAILURE: 'ASYNC_FAILURE',
} as const;
export type AuditEntityType =
  (typeof AuditEntityType)[keyof typeof AuditEntityType];

/** Exhaustive V1 registry. New events require an application contract change. */
export const AuditAction = {
  ADMIN_IDENTITY_CREATED: 'admin.identity.created',
  ADMIN_ROLE_CHANGED: 'admin.role.changed',
  ADMIN_PERMISSION_CHANGED: 'admin.permission.changed',
  ADMIN_DISABLED: 'admin.disabled',
  ADMIN_ENABLED: 'admin.enabled',
  ADMIN_PASSWORD_CHANGED: 'admin.password.changed',
  ADMIN_PASSWORD_RESET: 'admin.password.reset',
  ADMIN_LOGIN_SUCCEEDED: 'admin.auth.login.succeeded',
  ADMIN_LOGIN_FAILED: 'admin.auth.login.failed',
  ADMIN_REFRESH_REUSE_DETECTED: 'admin.auth.refresh.reuse_detected',
  ADMIN_SESSIONS_REVOKED_ALL: 'admin.auth.sessions.revoked_all',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  REGION_CREATED: 'region.created',
  REGION_UPDATED: 'region.updated',
  PRICE_CHANGED: 'price.changed',
  DISCOUNT_CREATED: 'discount.created',
  DISCOUNT_UPDATED: 'discount.updated',
  DISCOUNT_DEACTIVATED: 'discount.deactivated',
  INVENTORY_RECEIVED: 'inventory.received',
  INVENTORY_ADJUSTED: 'inventory.adjusted',
  INVENTORY_WRITTEN_OFF: 'inventory.written_off',
  INVENTORY_CORRECTED: 'inventory.corrected',
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_RETURNED: 'order.returned',
  SETTLEMENT_UPDATED: 'settlement.updated',
  SETTLEMENT_SETTLED: 'settlement.settled',
  COMMERCE_POLICY_UPDATED: 'commerce_policy.updated',
  VISITOR_CREATED: 'visitor.created',
  VISITOR_UPDATED: 'visitor.updated',
  VISITOR_DISABLED: 'visitor.disabled',
  BLOG_PUBLISHED: 'blog.published',
  BLOG_UNPUBLISHED: 'blog.unpublished',
  MEDIA_DELETED: 'media.deleted',
  ASYNC_REPLAY_REQUESTED: 'async.replay.requested',
  ASYNC_REPLAY_REJECTED: 'async.replay.rejected',
  ASYNC_REPLAY_SUCCEEDED: 'async.replay.succeeded',
  ASYNC_REPLAY_FAILED: 'async.replay.failed',
  ASYNC_FAILURE_ACKNOWLEDGED: 'async.failure.acknowledged',
  ASYNC_FAILURE_QUARANTINED: 'async.failure.quarantined',
  ASYNC_FAILURE_UNQUARANTINED: 'async.failure.unquarantined',
  ASYNC_FAILURE_DISMISSED: 'async.failure.dismissed',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ADMIN_LOGIN_FAILURE_REASONS = [
  'invalid_credentials',
  'account_disabled',
  'rate_limited',
] as const;
export type AdminLoginFailureReason =
  (typeof ADMIN_LOGIN_FAILURE_REASONS)[number];

type ChangedMetadata = { changedFields: readonly string[] };
type AdminRoleChangedMetadata = {
  changedFields: readonly ['role'];
  oldRole: AdminRole;
  newRole: AdminRole;
};
type ReasonMetadata = { reason: AdminLoginFailureReason };
type SessionMetadata = { sessionId: string };
type AsyncMetadata = { changedFields: readonly string[] };
type MetadataActions =
  | typeof AuditAction.ADMIN_LOGIN_FAILED
  | typeof AuditAction.ADMIN_LOGIN_SUCCEEDED
  | typeof AuditAction.ADMIN_REFRESH_REUSE_DETECTED
  | typeof AuditAction.PRICE_CHANGED
  | typeof AuditAction.ADMIN_ROLE_CHANGED
  | typeof AuditAction.ADMIN_PERMISSION_CHANGED
  | typeof AuditAction.PRODUCT_UPDATED
  | typeof AuditAction.CATEGORY_UPDATED
  | typeof AuditAction.REGION_UPDATED
  | typeof AuditAction.DISCOUNT_UPDATED
  | typeof AuditAction.INVENTORY_ADJUSTED
  | typeof AuditAction.INVENTORY_WRITTEN_OFF
  | typeof AuditAction.INVENTORY_CORRECTED
  | typeof AuditAction.SETTLEMENT_UPDATED
  | typeof AuditAction.VISITOR_UPDATED
  | typeof AuditAction.ASYNC_REPLAY_REQUESTED
  | typeof AuditAction.ASYNC_REPLAY_REJECTED
  | typeof AuditAction.ASYNC_REPLAY_SUCCEEDED
  | typeof AuditAction.ASYNC_REPLAY_FAILED
  | typeof AuditAction.ASYNC_FAILURE_ACKNOWLEDGED
  | typeof AuditAction.ASYNC_FAILURE_QUARANTINED
  | typeof AuditAction.ASYNC_FAILURE_UNQUARANTINED
  | typeof AuditAction.ASYNC_FAILURE_DISMISSED;
type AuditMetadataForAction = {
  [AuditAction.ADMIN_LOGIN_FAILED]: ReasonMetadata;
  [AuditAction.ADMIN_LOGIN_SUCCEEDED]: SessionMetadata;
  [AuditAction.ADMIN_REFRESH_REUSE_DETECTED]: SessionMetadata;
  [AuditAction.PRICE_CHANGED]: { previousPrice: number; newPrice: number };
  [AuditAction.ADMIN_ROLE_CHANGED]: AdminRoleChangedMetadata;
  [AuditAction.ADMIN_PERMISSION_CHANGED]: ChangedMetadata;
  [AuditAction.PRODUCT_UPDATED]: ChangedMetadata;
  [AuditAction.CATEGORY_UPDATED]: ChangedMetadata;
  [AuditAction.REGION_UPDATED]: ChangedMetadata;
  [AuditAction.DISCOUNT_UPDATED]: ChangedMetadata;
  [AuditAction.INVENTORY_ADJUSTED]: ChangedMetadata;
  [AuditAction.INVENTORY_WRITTEN_OFF]: ChangedMetadata;
  [AuditAction.INVENTORY_CORRECTED]: ChangedMetadata;
  [AuditAction.SETTLEMENT_UPDATED]: ChangedMetadata;
  [AuditAction.VISITOR_UPDATED]: ChangedMetadata;
  [AuditAction.ASYNC_REPLAY_REQUESTED]: AsyncMetadata;
  [AuditAction.ASYNC_REPLAY_REJECTED]: AsyncMetadata;
  [AuditAction.ASYNC_REPLAY_SUCCEEDED]: AsyncMetadata;
  [AuditAction.ASYNC_REPLAY_FAILED]: AsyncMetadata;
  [AuditAction.ASYNC_FAILURE_ACKNOWLEDGED]: AsyncMetadata;
  [AuditAction.ASYNC_FAILURE_QUARANTINED]: AsyncMetadata;
  [AuditAction.ASYNC_FAILURE_UNQUARANTINED]: AsyncMetadata;
  [AuditAction.ASYNC_FAILURE_DISMISSED]: AsyncMetadata;
} & { [A in Exclude<AuditAction, MetadataActions>]: undefined };
type ActionSpec = {
  entityType: AuditEntityType;
  entityId: 'required' | 'nullable' | 'absent';
  metadata: unknown;
};

const changed = (entityType: AuditEntityType): ActionSpec => ({
  entityType,
  entityId: 'required',
  metadata: {},
});
const identified = (entityType: AuditEntityType): ActionSpec => ({
  entityType,
  entityId: 'required',
  metadata: undefined,
});

/** Action-to-contract map: this is the source of truth for runtime validation. */
export const AUDIT_ACTION_SPECS: Record<AuditAction, ActionSpec> = {
  [AuditAction.ADMIN_IDENTITY_CREATED]: identified(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_ROLE_CHANGED]: changed(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_PERMISSION_CHANGED]: changed(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_DISABLED]: identified(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_ENABLED]: identified(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_PASSWORD_CHANGED]: identified(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_PASSWORD_RESET]: identified(AuditEntityType.ADMIN),
  [AuditAction.ADMIN_LOGIN_SUCCEEDED]: {
    entityType: AuditEntityType.ADMIN,
    entityId: 'required',
    metadata: {},
  },
  [AuditAction.ADMIN_LOGIN_FAILED]: {
    entityType: AuditEntityType.ADMIN,
    entityId: 'absent',
    metadata: {},
  },
  [AuditAction.ADMIN_REFRESH_REUSE_DETECTED]: {
    entityType: AuditEntityType.ADMIN,
    entityId: 'required',
    metadata: {},
  },
  [AuditAction.ADMIN_SESSIONS_REVOKED_ALL]: identified(AuditEntityType.ADMIN),
  [AuditAction.PRODUCT_CREATED]: identified(AuditEntityType.PRODUCT),
  [AuditAction.PRODUCT_UPDATED]: changed(AuditEntityType.PRODUCT),
  [AuditAction.CATEGORY_CREATED]: identified(AuditEntityType.CATEGORY),
  [AuditAction.CATEGORY_UPDATED]: changed(AuditEntityType.CATEGORY),
  [AuditAction.REGION_CREATED]: identified(AuditEntityType.REGION),
  [AuditAction.REGION_UPDATED]: changed(AuditEntityType.REGION),
  [AuditAction.PRICE_CHANGED]: {
    entityType: AuditEntityType.PRODUCT,
    entityId: 'required',
    metadata: {},
  },
  [AuditAction.DISCOUNT_CREATED]: identified(AuditEntityType.DISCOUNT),
  [AuditAction.DISCOUNT_UPDATED]: changed(AuditEntityType.DISCOUNT),
  [AuditAction.DISCOUNT_DEACTIVATED]: identified(AuditEntityType.DISCOUNT),
  [AuditAction.INVENTORY_RECEIVED]: identified(AuditEntityType.INVENTORY),
  [AuditAction.INVENTORY_ADJUSTED]: changed(AuditEntityType.INVENTORY),
  [AuditAction.INVENTORY_WRITTEN_OFF]: changed(AuditEntityType.INVENTORY),
  [AuditAction.INVENTORY_CORRECTED]: changed(AuditEntityType.INVENTORY),
  [AuditAction.ORDER_CREATED]: identified(AuditEntityType.ORDER),
  [AuditAction.ORDER_CANCELLED]: identified(AuditEntityType.ORDER),
  [AuditAction.ORDER_CONFIRMED]: identified(AuditEntityType.ORDER),
  [AuditAction.ORDER_SHIPPED]: identified(AuditEntityType.ORDER),
  [AuditAction.ORDER_DELIVERED]: identified(AuditEntityType.ORDER),
  [AuditAction.ORDER_RETURNED]: identified(AuditEntityType.ORDER),
  [AuditAction.SETTLEMENT_UPDATED]: changed(AuditEntityType.SETTLEMENT),
  [AuditAction.SETTLEMENT_SETTLED]: identified(AuditEntityType.SETTLEMENT),
  [AuditAction.COMMERCE_POLICY_UPDATED]: {
    entityType: AuditEntityType.COMMERCE_POLICY,
    entityId: 'nullable',
    metadata: undefined,
  },
  [AuditAction.VISITOR_CREATED]: identified(AuditEntityType.VISITOR),
  [AuditAction.VISITOR_UPDATED]: changed(AuditEntityType.VISITOR),
  [AuditAction.VISITOR_DISABLED]: identified(AuditEntityType.VISITOR),
  [AuditAction.BLOG_PUBLISHED]: identified(AuditEntityType.BLOG),
  [AuditAction.BLOG_UNPUBLISHED]: identified(AuditEntityType.BLOG),
  [AuditAction.MEDIA_DELETED]: identified(AuditEntityType.MEDIA),
  [AuditAction.ASYNC_REPLAY_REQUESTED]: changed(AuditEntityType.ASYNC_FAILURE),
  [AuditAction.ASYNC_REPLAY_REJECTED]: changed(AuditEntityType.ASYNC_FAILURE),
  [AuditAction.ASYNC_REPLAY_SUCCEEDED]: changed(AuditEntityType.ASYNC_FAILURE),
  [AuditAction.ASYNC_REPLAY_FAILED]: changed(AuditEntityType.ASYNC_FAILURE),
  [AuditAction.ASYNC_FAILURE_ACKNOWLEDGED]: changed(
    AuditEntityType.ASYNC_FAILURE,
  ),
  [AuditAction.ASYNC_FAILURE_QUARANTINED]: changed(
    AuditEntityType.ASYNC_FAILURE,
  ),
  [AuditAction.ASYNC_FAILURE_UNQUARANTINED]: changed(
    AuditEntityType.ASYNC_FAILURE,
  ),
  [AuditAction.ASYNC_FAILURE_DISMISSED]: changed(AuditEntityType.ASYNC_FAILURE),
};

export type AuditEvent = {
  [A in AuditAction]: {
    action: A;
    actorType: AuditActorType;
    actorId: string | null;
    entityType: (typeof AUDIT_ACTION_SPECS)[A]['entityType'];
    entityId: string | null;
    metadata: AuditMetadataForAction[A];
  };
}[AuditAction];

export type NormalizedAuditEvent = Omit<AuditEvent, 'metadata'> & {
  id: string;
  occurredAt: Date;
  requestId: string | null;
  correlationId: string | null;
  metadata: Prisma.InputJsonValue | null;
};

export class AuditEventValidationError extends Error {
  constructor() {
    super('Audit event is invalid.');
  }
}

export const AUDIT_METADATA_LIMITS = {
  maxBytes: 2048,
  maxDepth: 3,
  maxKeys: 12,
  maxStringLength: 256,
  maxArrayLength: 10,
} as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Field names in changedFields metadata — not arbitrary prose or PII payloads. */
const CHANGED_FIELD_NAME =
  /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/u;
const ACTOR_TYPES = new Set<string>(Object.values(AuditActorType));
const ENTITY_TYPES = new Set<string>(Object.values(AuditEntityType));
const ACTIONS = new Set<string>(Object.values(AuditAction));
const FAILURE_REASONS = new Set<string>(ADMIN_LOGIN_FAILURE_REASONS);

/** Validates and materializes id/timestamp; provenance linkage is service-owned. */
export function normalizeAuditEvent(input: AuditEvent): NormalizedAuditEvent {
  const candidate = input as unknown as Record<string, unknown>;
  const action = candidate['action'];
  const spec =
    typeof action === 'string' && ACTIONS.has(action)
      ? AUDIT_ACTION_SPECS[action as AuditAction]
      : undefined;
  if (
    spec === undefined ||
    !ACTOR_TYPES.has(candidate['actorType'] as string) ||
    !ENTITY_TYPES.has(candidate['entityType'] as string)
  )
    throw new AuditEventValidationError();
  const actorType = candidate['actorType'] as AuditActorType;
  const actorId = candidate['actorId'];
  if (
    actorType === AuditActorType.SYSTEM ||
    actorType === AuditActorType.ANONYMOUS
      ? actorId !== null
      : typeof actorId !== 'string' || !UUID.test(actorId)
  )
    throw new AuditEventValidationError();
  if (candidate['entityType'] !== spec.entityType)
    throw new AuditEventValidationError();
  const entityId = candidate['entityId'];
  if (!isValidEntityId(entityId, spec.entityId))
    throw new AuditEventValidationError();
  const metadata = candidate['metadata'];
  validateMetadata(action as AuditAction, metadata, spec.metadata);
  const normalizedMetadata =
    metadata === undefined ? null : (metadata as Prisma.InputJsonValue);
  return {
    ...input,
    id: randomUUID(),
    occurredAt: new Date(),
    requestId: null,
    correlationId: null,
    metadata: normalizedMetadata,
  };
}

function validateMetadata(
  action: AuditAction,
  value: unknown,
  expected: unknown,
): void {
  if (expected === undefined) {
    if (value !== undefined) throw new AuditEventValidationError();
    return;
  }
  if (!isPlainObject(value)) throw new AuditEventValidationError();
  const keys = Object.keys(value);
  const allowed =
    action === AuditAction.ADMIN_LOGIN_FAILED
      ? ['reason']
      : action === AuditAction.ADMIN_LOGIN_SUCCEEDED ||
          action === AuditAction.ADMIN_REFRESH_REUSE_DETECTED
        ? ['sessionId']
        : action === AuditAction.PRICE_CHANGED
          ? ['previousPrice', 'newPrice']
          : action === AuditAction.ADMIN_ROLE_CHANGED
            ? ['changedFields', 'oldRole', 'newRole']
            : ['changedFields'];
  if (
    keys.some((key) => !allowed.includes(key)) ||
    keys.length !== allowed.length
  )
    throw new AuditEventValidationError();
  if (
    action === AuditAction.ADMIN_ROLE_CHANGED &&
    (!Array.isArray(value['changedFields']) ||
      value['changedFields'].length !== 1 ||
      value['changedFields'][0] !== 'role' ||
      !isAdminRole(value['oldRole']) ||
      !isAdminRole(value['newRole']))
  )
    throw new AuditEventValidationError();
  if (
    action === AuditAction.ADMIN_LOGIN_FAILED &&
    (typeof value['reason'] !== 'string' ||
      !FAILURE_REASONS.has(value['reason']))
  )
    throw new AuditEventValidationError();
  if (
    (action === AuditAction.ADMIN_LOGIN_SUCCEEDED ||
      action === AuditAction.ADMIN_REFRESH_REUSE_DETECTED) &&
    (typeof value['sessionId'] !== 'string' || !UUID.test(value['sessionId']))
  )
    throw new AuditEventValidationError();
  if (
    action === AuditAction.PRICE_CHANGED &&
    ![value['previousPrice'], value['newPrice']].every(
      (item) =>
        typeof item === 'number' && Number.isSafeInteger(item) && item >= 0,
    )
  )
    throw new AuditEventValidationError();
  if (
    action !== AuditAction.ADMIN_LOGIN_FAILED &&
    action !== AuditAction.ADMIN_LOGIN_SUCCEEDED &&
    action !== AuditAction.ADMIN_REFRESH_REUSE_DETECTED &&
    action !== AuditAction.PRICE_CHANGED &&
    action !== AuditAction.ADMIN_ROLE_CHANGED
  ) {
    const fields = value['changedFields'];
    if (
      !Array.isArray(fields) ||
      fields.length === 0 ||
      fields.length > AUDIT_METADATA_LIMITS.maxArrayLength ||
      !fields.every(
        (field) =>
          typeof field === 'string' &&
          field.length > 0 &&
          field.length <= AUDIT_METADATA_LIMITS.maxStringLength &&
          CHANGED_FIELD_NAME.test(field),
      )
    )
      throw new AuditEventValidationError();
  }
  inspectJson(value, 1);
  if (measureMetadataBytes(value) > AUDIT_METADATA_LIMITS.maxBytes)
    throw new AuditEventValidationError();
}

function measureMetadataBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new AuditEventValidationError();
  }
}

function isValidEntityId(
  entityId: unknown,
  rule: ActionSpec['entityId'],
): boolean {
  if (rule === 'required') {
    return typeof entityId === 'string' && UUID.test(entityId);
  }
  if (rule === 'absent') {
    return entityId === null;
  }
  return (
    entityId === null || (typeof entityId === 'string' && UUID.test(entityId))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function inspectJson(value: unknown, depth: number): void {
  if (depth > AUDIT_METADATA_LIMITS.maxDepth)
    throw new AuditEventValidationError();
  if (typeof value === 'string') {
    if (value.length > AUDIT_METADATA_LIMITS.maxStringLength)
      throw new AuditEventValidationError();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > AUDIT_METADATA_LIMITS.maxArrayLength)
      throw new AuditEventValidationError();
    value.forEach((item) => inspectJson(item, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (
      keys.length > AUDIT_METADATA_LIMITS.maxKeys ||
      keys.some((key) => key.length > AUDIT_METADATA_LIMITS.maxStringLength)
    )
      throw new AuditEventValidationError();
    keys.forEach((key) => inspectJson(value[key], depth + 1));
    return;
  }
  if (value !== null && typeof value !== 'number' && typeof value !== 'boolean')
    throw new AuditEventValidationError();
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new AuditEventValidationError();
}
