import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderBodyDto } from './create-order.dto';

const validBody = {
  regionId: '11111111-1111-4111-8111-111111111111',
  lines: [
    {
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    },
  ],
};

describe('CreateOrderBodyDto customerNote', () => {
  it('trims a valid Unicode note and preserves its content', async () => {
    const dto = plainToInstance(CreateOrderBodyDto, {
      ...validBody,
      customerNote: '  لطفاً قبل از تحویل تماس بگیرید  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.customerNote).toBe('لطفاً قبل از تحویل تماس بگیرید');
  });

  it('accepts blank input and normalizes it to an empty value for application handling', async () => {
    const dto = plainToInstance(CreateOrderBodyDto, {
      ...validBody,
      customerNote: '   ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.customerNote).toBe('');
  });

  it('rejects notes longer than 500 characters', async () => {
    const dto = plainToInstance(CreateOrderBodyDto, {
      ...validBody,
      customerNote: 'x'.repeat(501),
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'customerNote')).toBe(
      true,
    );
  });
});
