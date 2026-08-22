import {
  OrderActorType,
  assertAdminActor,
  assertUserActor,
} from './order-actor';
import { OrderInvalidInputError } from './order-errors';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('order actors', () => {
  it('accepts USER and ADMIN actors with UUID ids', () => {
    expect(assertUserActor({ type: OrderActorType.USER, id: USER_ID })).toEqual(
      { type: OrderActorType.USER, id: USER_ID },
    );
    expect(
      assertAdminActor({ type: OrderActorType.ADMIN, id: ADMIN_ID }),
    ).toEqual({ type: OrderActorType.ADMIN, id: ADMIN_ID });
  });

  it('rejects actor type confusion', () => {
    expect(() =>
      assertAdminActor({ type: OrderActorType.USER, id: USER_ID }),
    ).toThrow(OrderInvalidInputError);
    expect(() =>
      assertUserActor({ type: OrderActorType.ADMIN, id: ADMIN_ID }),
    ).toThrow(OrderInvalidInputError);
  });
});
