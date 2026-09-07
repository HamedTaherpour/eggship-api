import {
  hashOrderCreatePayload,
  normalizeCustomerNote,
} from './order-create-idempotency';

const input = {
  regionId: '11111111-1111-4111-8111-111111111111',
  lines: [
    {
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    },
  ],
};

describe('customer checkout note idempotency', () => {
  it('normalizes missing and whitespace-only notes to null', () => {
    expect(normalizeCustomerNote(undefined)).toBeNull();
    expect(normalizeCustomerNote(' \t\n')).toBeNull();
  });

  it('keeps no-note hashes backward-compatible and distinguishes real notes', () => {
    expect(hashOrderCreatePayload(input)).toBe(
      hashOrderCreatePayload({ ...input, customerNote: '   ' }),
    );
    expect(hashOrderCreatePayload(input)).not.toBe(
      hashOrderCreatePayload({
        ...input,
        customerNote: 'Call before delivery',
      }),
    );
  });
});
