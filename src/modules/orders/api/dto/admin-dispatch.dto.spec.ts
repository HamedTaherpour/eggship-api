import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderStatus } from '../../domain/order-status';
import { AdminDispatchQueryDto } from './admin-dispatch.dto';

async function validateQuery(
  input: Record<string, unknown>,
): Promise<{ dto: AdminDispatchQueryDto; errors: string[] }> {
  const dto = plainToInstance(AdminDispatchQueryDto, input);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    errors: errors.flatMap((error) => Object.values(error.constraints ?? {})),
  };
}

describe('AdminDispatchQueryDto', () => {
  it('accepts empty query and pipeline filters', async () => {
    expect((await validateQuery({})).errors).toEqual([]);
    expect(
      (
        await validateQuery({
          regionId: '11111111-1111-4111-8111-111111111111',
          status: OrderStatus.CONFIRMED,
        })
      ).errors,
    ).toEqual([]);
    expect(
      (await validateQuery({ status: OrderStatus.SHIPPED })).errors,
    ).toEqual([]);
  });

  it('rejects non-pipeline statuses and unknown keys', async () => {
    expect(
      (await validateQuery({ status: OrderStatus.DELIVERED })).errors.length,
    ).toBeGreaterThan(0);
    expect(
      (await validateQuery({ status: OrderStatus.PENDING_REVIEW })).errors
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await validateQuery({ search: 'eggs' })).errors.length,
    ).toBeGreaterThan(0);
    expect((await validateQuery({ page: '1' })).errors.length).toBeGreaterThan(
      0,
    );
  });
});
