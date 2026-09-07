import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  normalizeException,
  normalizeValidationErrors,
} from './error-contract';
import { ApplicationError } from '../errors/application-error';

describe('shared error contract', () => {
  it('keeps safe typed 4xx errors and strips unsafe detail keys', () => {
    expect(
      normalizeException(
        new ApplicationError('ORDER_CONFLICT', 'safe', HttpStatus.CONFLICT, {
          minimumQuantity: 5,
          internalId: 'secret',
        }),
      ),
    ).toEqual({
      code: 'ORDER_CONFLICT',
      message: 'انجام این عملیات با وضعیت فعلی ممکن نیست.',
      details: { minimumQuantity: 5 },
    });
  });

  it('sanitizes internal ApplicationError and plain Error failures', () => {
    expect(
      normalizeException(
        new ApplicationError(
          'DB_FAILURE',
          'database password',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      ),
    ).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
      details: {},
    });
    expect(normalizeException(new Error('provider secret'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.',
      details: {},
    });
  });

  it('normalizes generic Nest exceptions without exposing framework text', () => {
    expect(
      normalizeException(
        new HttpException('Cannot GET /secret', HttpStatus.NOT_FOUND),
      ),
    ).toEqual({
      code: 'NOT_FOUND',
      message: 'موردنظر پیدا نشد.',
      details: {},
    });
  });

  it('never exposes English constructor text from a public typed error', () => {
    const normalized = normalizeException(
      new ApplicationError(
        'ORDER_INVALID_INPUT',
        'The internal parser rejected this request.',
        HttpStatus.BAD_REQUEST,
      ),
    );

    expect(normalized.message).toBe('اطلاعات واردشده معتبر نیست.');
    expect(normalized.message).not.toMatch(/[A-Za-z]/u);
  });

  it('preserves custom public codes on Nest exceptions with safe copy', () => {
    expect(
      normalizeException(
        new BadRequestException({
          code: 'IDEMPOTENCY_KEY_INVALID',
          message: 'The key is invalid.',
        }),
      ),
    ).toEqual({
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'کلید جلوگیری از ثبت تکراری معتبر نیست.',
      details: {},
    });
  });

  it('creates stable nested and indexed validation violations', () => {
    const errors: ValidationError[] = [
      {
        property: 'items',
        children: [
          {
            property: '0',
            children: [
              { property: 'phone', constraints: { isString: 'raw wording' } },
            ],
          },
        ],
      },
    ];
    expect(normalizeValidationErrors(errors)).toEqual([
      {
        field: 'items.0.phone',
        rule: 'isString',
        message: 'این مقدار باید متن باشد.',
      },
    ]);
    expect(
      normalizeException(new BadRequestException({ message: errors })),
    ).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'اطلاعات واردشده معتبر نیست.',
      details: {
        violations: [
          {
            field: 'items.0.phone',
            rule: 'isString',
            message: 'این مقدار باید متن باشد.',
          },
        ],
      },
    });
  });
});
