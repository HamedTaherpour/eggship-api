import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  AuditEventValidationError,
  normalizeAuditEvent,
} from './audit-event';

const adminId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const discountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function loginSuccess(overrides: Record<string, unknown> = {}): never {
  return {
    action: AuditAction.ADMIN_LOGIN_SUCCEEDED,
    actorType: AuditActorType.ADMIN,
    actorId: adminId,
    entityType: AuditEntityType.ADMIN,
    entityId: adminId,
    metadata: { sessionId },
    ...overrides,
  } as never;
}

describe('Audit event contract', () => {
  it('accepts a typed event and leaves request linkage to the service boundary', () => {
    const result = normalizeAuditEvent(loginSuccess());
    expect(result.requestId).toBeNull();
    expect(result.correlationId).toBeNull();
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it.each([
    ['unknown action', { action: 'admin.evil' }],
    ['unknown entity', { entityType: 'SECRET' }],
    [
      'wrong entity id presence',
      {
        action: AuditAction.ADMIN_LOGIN_FAILED,
        actorType: AuditActorType.ANONYMOUS,
        actorId: null,
        entityType: AuditEntityType.ADMIN,
        entityId: adminId,
        metadata: { reason: 'invalid_credentials' },
      },
    ],
    [
      'invalid actor combination',
      { actorType: AuditActorType.SYSTEM, actorId: adminId },
    ],
    ['unknown metadata key', { metadata: { sessionId, password: 'secret' } }],
    ['wrong metadata shape', { metadata: ['session'] }],
    ['oversized metadata', { metadata: { sessionId: 'x'.repeat(300) } }],
    [
      'excessive nesting',
      {
        action: AuditAction.PRODUCT_UPDATED,
        entityType: AuditEntityType.PRODUCT,
        metadata: {
          changedFields: ['name'],
          nested: { one: { two: { three: { four: true } } } },
        },
      },
    ],
  ])('rejects %s', (_name, overrides) => {
    expect(() => normalizeAuditEvent(loginSuccess(overrides))).toThrow(
      AuditEventValidationError,
    );
  });

  it('accepts discount deactivation and excludes the obsolete deleted action', () => {
    expect(
      normalizeAuditEvent({
        action: AuditAction.DISCOUNT_DEACTIVATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.DISCOUNT,
        entityId: discountId,
        metadata: undefined,
      }),
    ).toMatchObject({ action: AuditAction.DISCOUNT_DEACTIVATED });
    expect(Object.values(AuditAction)).not.toContain('discount.deleted');
    expect(() =>
      normalizeAuditEvent({
        action: 'discount.deleted',
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.DISCOUNT,
        entityId: discountId,
        metadata: undefined,
      } as never),
    ).toThrow(AuditEventValidationError);
  });

  it('accepts commerce policy updates with or without a UUID entity id', () => {
    const overrideId = '33333333-3333-4333-8333-333333333333';
    expect(
      normalizeAuditEvent({
        action: AuditAction.COMMERCE_POLICY_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.COMMERCE_POLICY,
        entityId: null,
        metadata: undefined,
      }),
    ).toMatchObject({ entityId: null });
    expect(
      normalizeAuditEvent({
        action: AuditAction.COMMERCE_POLICY_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.COMMERCE_POLICY,
        entityId: overrideId,
        metadata: undefined,
      }),
    ).toMatchObject({ entityId: overrideId });
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.COMMERCE_POLICY_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.COMMERCE_POLICY,
        entityId: 'not-a-uuid',
        metadata: undefined,
      }),
    ).toThrow(AuditEventValidationError);
  });

  it('enforces required, nullable, and absent entityId rules per action', () => {
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.ORDER_CREATED,
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        entityType: AuditEntityType.ORDER,
        entityId: null,
        metadata: undefined,
      }),
    ).toThrow(AuditEventValidationError);
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.ADMIN_LOGIN_FAILED,
        actorType: AuditActorType.ANONYMOUS,
        actorId: null,
        entityType: AuditEntityType.ADMIN,
        entityId: adminId,
        metadata: { reason: 'invalid_credentials' },
      }),
    ).toThrow(AuditEventValidationError);
  });

  it('accepts only the approved anonymous failed-login contract', () => {
    const result = normalizeAuditEvent({
      action: AuditAction.ADMIN_LOGIN_FAILED,
      actorType: AuditActorType.ANONYMOUS,
      actorId: null,
      entityType: AuditEntityType.ADMIN,
      entityId: null,
      metadata: { reason: 'rate_limited' },
    });
    expect(result.metadata).toEqual({ reason: 'rate_limited' });
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.ADMIN_LOGIN_FAILED,
        actorType: AuditActorType.ANONYMOUS,
        actorId: null,
        entityType: AuditEntityType.ADMIN,
        entityId: null,
        metadata: { reason: 'redis_unavailable' },
      } as never),
    ).toThrow(AuditEventValidationError);
  });

  it.each([
    ['name', ['name']],
    ['camelCase field', ['isActive']],
    ['long domain field', ['orderingOpensAtLocalMinute']],
    ['dotted field', ['schedule.orderingOpensAtLocalMinute']],
  ])('accepts changedFields with %s', (_label, changedFields) => {
    const result = normalizeAuditEvent({
      action: AuditAction.PRODUCT_UPDATED,
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      entityType: AuditEntityType.PRODUCT,
      entityId: productId,
      metadata: { changedFields },
    });
    expect(result.metadata).toEqual({ changedFields });
  });

  it.each([
    ['email-like value', ['user@example.com']],
    ['whitespace prose', ['updated the name field']],
    ['url-like value', ['https://example.com/path']],
    ['numeric-only token', ['123']],
  ])('rejects changedFields containing %s', (_label, changedFields) => {
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.PRODUCT_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.PRODUCT,
        entityId: productId,
        metadata: { changedFields },
      }),
    ).toThrow(AuditEventValidationError);
  });

  it('rejects cyclic metadata through the canonical validation error', () => {
    const cyclic: Record<string, unknown> = { changedFields: ['name'] };
    cyclic['self'] = cyclic;
    expect(() =>
      normalizeAuditEvent({
        action: AuditAction.PRODUCT_UPDATED,
        actorType: AuditActorType.ADMIN,
        actorId: adminId,
        entityType: AuditEntityType.PRODUCT,
        entityId: productId,
        metadata: cyclic,
      } as never),
    ).toThrow(AuditEventValidationError);
  });
});
