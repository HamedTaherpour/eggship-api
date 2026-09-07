import { HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { AuthError } from '../../modules/auth/domain/auth-error';
import { ApplicationError } from '../errors/application-error';

export interface PublicError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface ErrorResponseBody {
  error: PublicError;
  requestId: string;
}

const INTERNAL_MESSAGE = 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
const VALIDATION_MESSAGE = 'اطلاعات واردشده معتبر نیست.';

/** Converts only deliberately safe, user-facing detail values to JSON data. */
export function safePublicDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return isRecord(details) ? sanitizeRecord(details) : {};
}

export function normalizeException(
  exception: unknown,
  statusOverride?: number,
): PublicError {
  if (isPublicApplicationError(exception)) {
    const status =
      exception instanceof AuthError
        ? statusForAuthCode(exception.code)
        : exception.httpStatus;
    return {
      code: exception.code,
      message: publicMessageForCode(exception.code, status, exception.message),
      details: safePublicDetails(exception.details),
    };
  }

  if (exception instanceof HttpException) {
    const status = statusOverride ?? exception.getStatus();
    if (status >= 500) return internalPublicError();

    const response = exception.getResponse();
    if (isValidationResponse(response)) {
      return {
        code: 'VALIDATION_ERROR',
        message: VALIDATION_MESSAGE,
        details: { violations: normalizeValidationErrors(response.message) },
      };
    }

    return {
      code: extractPublicCode(response) ?? codeForStatus(status),
      message: messageForStatus(
        extractPublicCode(response) ?? codeForStatus(status),
        status,
      ),
      details: {},
    };
  }

  return internalPublicError();
}

function statusForAuthCode(code: string): number {
  if (code === 'AUTH_FORBIDDEN' || code.startsWith('CSRF_')) return 403;
  if (code === 'AUTH_RATE_LIMITED' || code === 'AUTH_OTP_RATE_LIMITED')
    return 429;
  if (code === 'AUTH_UNAVAILABLE' || code === 'AUTH_OTP_UNAVAILABLE')
    return 503;
  return 401;
}

export function internalPublicError(): PublicError {
  return { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE, details: {} };
}

export function normalizeValidationErrors(
  errors: ValidationError[],
): Array<{ field: string; rule: string; message: string }> {
  const violations: Array<{ field: string; rule: string; message: string }> =
    [];
  for (const error of errors)
    collectValidationViolations(error, '', violations);
  return violations;
}

function collectValidationViolations(
  error: ValidationError,
  parentPath: string,
  output: Array<{ field: string; rule: string; message: string }>,
): void {
  const field =
    parentPath === '' ? error.property : `${parentPath}.${error.property}`;
  if (error.constraints !== undefined) {
    for (const rule of Object.keys(error.constraints)) {
      output.push({ field, rule, message: validationMessage(rule) });
    }
  }
  for (const child of error.children ?? [])
    collectValidationViolations(child, field, output);
}

function isPublicApplicationError(
  exception: unknown,
): exception is ApplicationError | AuthError {
  if (exception instanceof AuthError) return true;
  return exception instanceof ApplicationError && exception.httpStatus < 500;
}

function isValidationResponse(
  response: unknown,
): response is { message: ValidationError[] } {
  return (
    isRecord(response) &&
    Array.isArray(response.message) &&
    response.message.every(isValidationError)
  );
}

function isValidationError(value: unknown): value is ValidationError {
  return isRecord(value) && typeof value.property === 'string';
}

function validationMessage(rule: string): string {
  const messages: Record<string, string> = {
    whitelistValidation: 'این فیلد مجاز نیست.',
    isString: 'این مقدار باید متن باشد.',
    isInt: 'این مقدار باید عدد صحیح باشد.',
    isNumber: 'این مقدار باید عدد باشد.',
    isBoolean: 'این مقدار باید درست یا نادرست باشد.',
    isNotEmpty: 'وارد کردن این مقدار الزامی است.',
    isOptional: 'این مقدار معتبر نیست.',
    isEmail: 'نشانی ایمیل واردشده معتبر نیست.',
    isUUID: 'شناسه واردشده معتبر نیست.',
    isIn: 'مقدار انتخاب‌شده معتبر نیست.',
    min: 'این مقدار کمتر از حد مجاز است.',
    max: 'این مقدار بیشتر از حد مجاز است.',
    minLength: 'طول این مقدار کمتر از حد مجاز است.',
    maxLength: 'طول این مقدار بیشتر از حد مجاز است.',
  };
  return messages[rule] ?? 'این مقدار معتبر نیست.';
}

function codeForStatus(status: number): string {
  const codes: Partial<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  };
  return codes[status] ?? 'HTTP_ERROR';
}

function messageForStatus(code: string, status: number): string {
  return publicMessageForCode(code, status);
}

/**
 * The HTTP boundary owns display copy. Domain errors may retain diagnostic
 * English text for logs and tests, but it can never become public response
 * text. Unknown public codes deliberately fall back to safe Persian copy.
 */
export function publicMessageForCode(
  code: string,
  status: number,
  existingMessage?: string,
): string {
  if (status >= 500) return INTERNAL_MESSAGE;
  if (existingMessage !== undefined && isPersianMessage(existingMessage)) {
    return existingMessage;
  }
  const messages: Record<string, string> = {
    AUTH_INVALID_CREDENTIALS: 'ایمیل یا رمز عبور نادرست است.',
    AUTH_TOKEN_EXPIRED: 'نشست شما منقضی شده است.',
    AUTH_SESSION_EXPIRED: 'نشست شما منقضی شده است.',
    AUTH_SESSION_REVOKED: 'نشست شما دیگر معتبر نیست.',
    AUTH_REFRESH_TOKEN_REUSED: 'نشست شما دیگر معتبر نیست.',
    AUTH_REFRESH_TOKEN_MISSING: 'برای ادامه، وارد حساب کاربری خود شوید.',
    AUTH_INVALID_TOKEN: 'نشست شما معتبر نیست.',
    AUTH_ACCOUNT_DISABLED: 'حساب کاربری شما غیرفعال است.',
    AUTH_UNAUTHENTICATED: 'برای ادامه، وارد حساب کاربری خود شوید.',
    AUTH_FORBIDDEN: 'شما اجازه انجام این عملیات را ندارید.',
    AUTH_RATE_LIMITED: 'تعداد درخواست‌ها بیش از حد مجاز است.',
    AUTH_UNAVAILABLE: 'سرویس احراز هویت موقتاً در دسترس نیست.',
    AUTH_OTP_COOLDOWN: 'لطفاً پیش از درخواست دوباره، کمی صبر کنید.',
    AUTH_OTP_RATE_LIMITED: 'تعداد درخواست‌های کد تأیید بیش از حد مجاز است.',
    AUTH_OTP_INVALID: 'کد تأیید نادرست است.',
    AUTH_OTP_EXPIRED: 'کد تأیید منقضی شده است.',
    AUTH_OTP_TOO_MANY_ATTEMPTS: 'تعداد تلاش‌ها بیش از حد مجاز است.',
    AUTH_OTP_ALREADY_USED: 'این کد تأیید قبلاً استفاده شده است.',
    AUTH_OTP_DELIVERY_FAILED: 'ارسال کد تأیید انجام نشد.',
    AUTH_OTP_UNAVAILABLE: 'سرویس ارسال کد تأیید موقتاً در دسترس نیست.',
    AUTH_VERIFICATION_GRANT_INVALID: 'تأیید هویت معتبر نیست.',
    AUTH_VERIFICATION_GRANT_EXPIRED: 'تأیید هویت منقضی شده است.',
    AUTH_VERIFICATION_GRANT_USED: 'این تأیید هویت قبلاً استفاده شده است.',
    AUTH_REGISTRATION_CONFLICT: 'ثبت حساب انجام نشد. دوباره تلاش کنید.',
    CSRF_TOKEN_MISSING: 'برای انجام این عملیات، تأیید امنیتی لازم است.',
    CSRF_TOKEN_INVALID: 'تأیید امنیتی معتبر نیست.',
    CSRF_ORIGIN_INVALID: 'مبدأ درخواست مجاز نیست.',
    IDEMPOTENCY_KEY_REQUIRED: 'کلید جلوگیری از ثبت تکراری الزامی است.',
    IDEMPOTENCY_KEY_INVALID: 'کلید جلوگیری از ثبت تکراری معتبر نیست.',
  };
  const specific = messages[code];
  if (specific !== undefined) return specific;
  if (status === 400 || status === 422) return VALIDATION_MESSAGE;
  if (status === 401) return 'برای ادامه، وارد حساب کاربری خود شوید.';
  if (status === 403) return 'شما اجازه انجام این عملیات را ندارید.';
  if (status === 404) return 'موردنظر پیدا نشد.';
  if (status === 409) return 'انجام این عملیات با وضعیت فعلی ممکن نیست.';
  if (status === 429) return 'تعداد درخواست‌ها بیش از حد مجاز است.';
  if (status === 503) return 'سرویس موقتاً در دسترس نیست.';
  return 'درخواست شما قابل انجام نیست.';
}

function isPersianMessage(message: string): boolean {
  return /[\u0600-\u06ff]/u.test(message) && !/[A-Za-z]{3,}/u.test(message);
}

function extractPublicCode(response: unknown): string | undefined {
  if (!isRecord(response) || typeof response.code !== 'string')
    return undefined;
  const code = response.code.trim();
  return code === '' ? undefined : code;
}

function sanitizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /(id|token|secret|password|stack|cause|diagnostic|provider|prisma|query)$/iu.test(
        key,
      )
    )
      continue;
    if (isRecord(item)) result[key] = sanitizeRecord(item);
    else if (Array.isArray(item))
      result[key] = item.filter((entry) => !isRecord(entry)).slice(0, 50);
    else if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
    )
      result[key] = item;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
