const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'accesstoken',
  'refreshtoken',
  'token',
  'otp',
  'otpcode',
  'password',
  'passwd',
  'secret',
  'apikey',
  'xapikey',
  'databaseurl',
  'redisurl',
  'dbpassword',
  'email',
  'phonenumber',
  'phone',
  'address',
  'fulladdress',
  'digest',
  'refreshtokenhash',
  'passwordhash',
  'secretkey',
  'accesskey',
]);

export function redactLogFields(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return redactRecord(fields, new WeakSet<object>());
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s/]+@/giu, `$1${REDACTED}@`)
    .replace(/(rediss?:\/\/)[^@\s/]+@/giu, `$1${REDACTED}@`)
    .replace(/(https?:\/\/)[^@\s/]+@/giu, `$1${REDACTED}@`)
    .replace(/\bBearer\s+[^\s,;]+/giu, `Bearer ${REDACTED}`)
    .replace(
      /\b(password|(?:client[_-]?)?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|otp)(\s*[=:]\s*)[^\s,;]+/giu,
      `$1$2${REDACTED}`,
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      '[REDACTED_EMAIL]',
    );
}

export function sanitizeError(error: Error): Error {
  const sanitized = new Error(redactSensitiveText(error.message));
  sanitized.name = error.name;
  if (error.stack !== undefined) {
    sanitized.stack = redactSensitiveText(error.stack);
  }
  return sanitized;
}

function redactRecord(
  value: Readonly<Record<string, unknown>>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (seen.has(value)) {
    return { circular: '[Circular]' };
  }
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactValue(entry, seen),
    ]),
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (value instanceof Error) {
    return sanitizeError(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRecord(value)) {
    return redactRecord(value, seen);
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalizedKey) ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('apikey') ||
    normalizedKey.includes('otp') ||
    normalizedKey.includes('tokenhash') ||
    normalizedKey.endsWith('token') ||
    normalizedKey.endsWith('digest') ||
    normalizedKey.endsWith('email') ||
    normalizedKey.endsWith('phone') ||
    normalizedKey.endsWith('phonenumber') ||
    normalizedKey.endsWith('address')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
