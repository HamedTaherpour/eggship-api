import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ADMIN_BULK_ORDER_TRANSITION_MAXIMUM,
  BulkOrderTransitionAction,
} from '../../application/bulk-order-transition.service';
import { AdminBulkOrderTransitionBodyDto } from './admin-bulk-order-transition.dto';

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';

const nestOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: false,
} as const;

describe('AdminBulkOrderTransitionBodyDto', () => {
  it('accepts SHIP and DELIVER with 1..50 unique UUIDs', async () => {
    for (const action of [
      BulkOrderTransitionAction.SHIP,
      BulkOrderTransitionAction.DELIVER,
    ]) {
      const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
        action,
        orderIds: [ORDER_A, ORDER_B],
      });
      expect(await validate(body, nestOptions)).toHaveLength(0);
    }
  });

  it('rejects unsupported actions', async () => {
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: 'CONFIRM',
      orderIds: [ORDER_A],
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });

  it('rejects empty orderIds', async () => {
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [],
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });

  it('rejects more than 50 orderIds', async () => {
    const orderIds = Array.from(
      { length: ADMIN_BULK_ORDER_TRANSITION_MAXIMUM + 1 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    );
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: BulkOrderTransitionAction.SHIP,
      orderIds,
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });

  it('rejects duplicate orderIds', async () => {
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A, ORDER_A],
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });

  it('rejects invalid UUIDs', async () => {
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: BulkOrderTransitionAction.SHIP,
      orderIds: ['not-a-uuid'],
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });

  it('rejects unknown fields', async () => {
    const body = plainToInstance(AdminBulkOrderTransitionBodyDto, {
      action: BulkOrderTransitionAction.SHIP,
      orderIds: [ORDER_A],
      targetStatus: 'SHIPPED',
    });
    expect((await validate(body, nestOptions)).length).toBeGreaterThan(0);
  });
});
