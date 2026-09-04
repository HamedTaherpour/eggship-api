export const NOTIFICATION_TITLE_MAX_LENGTH = 160;
export const NOTIFICATION_BODY_MAX_LENGTH = 2_000;
export const NOTIFICATION_PAYLOAD_MAX_BYTES = 8_192;
export const NOTIFICATION_PAYLOAD_MAX_DEPTH = 4;
export const NOTIFICATION_PAYLOAD_MAX_KEYS = 32;
export const NOTIFICATION_PAYLOAD_MAX_ARRAY_ITEMS = 16;
export const NOTIFICATION_PAYLOAD_STRING_MAX_LENGTH = 512;

export const NotificationType = {
  ORDER_STATUS: 'ORDER_STATUS',
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationSource = {
  ORDER_TRANSITION: 'ORDER_TRANSITION',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationSource =
  (typeof NotificationSource)[keyof typeof NotificationSource];

export type NotificationJsonValue =
  | string
  | number
  | boolean
  | null
  | NotificationJsonValue[]
  | { [key: string]: NotificationJsonValue };

export type NotificationPayload = {
  [key: string]: NotificationJsonValue;
};

export interface CreateNotificationInput {
  /** Optional server-assigned id used to bind a notification to an outbox event. */
  notificationId?: string;
  userId: string;
  type: NotificationType;
  source: NotificationSource;
  title: string;
  body: string;
  payload: NotificationPayload;
}

export interface NotificationRecord extends CreateNotificationInput {
  id: string;
  createdAt: Date;
  readAt: Date | null;
  pushDeliveriesMaterializedAt?: Date | null;
}

export class NotificationInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationInvalidInputError';
  }
}

export class NotificationInvalidUserError extends Error {
  constructor() {
    super('Notification user does not exist.');
    this.name = 'NotificationInvalidUserError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_PAYLOAD_KEY =
  /(?:authorization|cookie|password|secret|token|apikey|otp|email|phone|address)/iu;

export function normalizeNotificationInput(
  input: CreateNotificationInput,
): CreateNotificationInput {
  if (
    input.notificationId !== undefined &&
    !UUID_PATTERN.test(input.notificationId)
  ) {
    throw new NotificationInvalidInputError('notificationId must be a UUID.');
  }
  if (!UUID_PATTERN.test(input.userId)) {
    throw new NotificationInvalidInputError('userId must be a UUID.');
  }
  if (input.type !== NotificationType.ORDER_STATUS) {
    throw new NotificationInvalidInputError('Notification type is invalid.');
  }
  if (
    input.source !== NotificationSource.ORDER_TRANSITION &&
    input.source !== NotificationSource.SYSTEM
  ) {
    throw new NotificationInvalidInputError('Notification source is invalid.');
  }
  const title = requireText(
    input.title,
    'title',
    NOTIFICATION_TITLE_MAX_LENGTH,
  );
  const body = requireText(input.body, 'body', NOTIFICATION_BODY_MAX_LENGTH);
  validatePayload(input.payload);
  return {
    ...input,
    notificationId: input.notificationId?.toLowerCase(),
    userId: input.userId.toLowerCase(),
    title,
    body,
  };
}

export function assertNotificationUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new NotificationInvalidInputError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function requireText(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new NotificationInvalidInputError(`${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new NotificationInvalidInputError(
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function validatePayload(
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): asserts value is NotificationPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new NotificationInvalidInputError(
      'Notification payload must be an object.',
    );
  }
  if (depth > NOTIFICATION_PAYLOAD_MAX_DEPTH) {
    throw new NotificationInvalidInputError(
      'Notification payload is too deeply nested.',
    );
  }
  if (ancestors.has(value)) {
    throw new NotificationInvalidInputError(
      'Notification payload must not be circular.',
    );
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new NotificationInvalidInputError(
      'Notification payload must contain plain JSON.',
    );
  }
  const entries = Object.entries(value);
  if (entries.length > NOTIFICATION_PAYLOAD_MAX_KEYS) {
    throw new NotificationInvalidInputError(
      'Notification payload has too many fields.',
    );
  }
  ancestors.add(value);
  for (const [key, nested] of entries) {
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/u.test(key)) {
      throw new NotificationInvalidInputError(
        'Notification payload contains an invalid field name.',
      );
    }
    if (FORBIDDEN_PAYLOAD_KEY.test(key)) {
      throw new NotificationInvalidInputError(
        'Notification payload contains a sensitive field.',
      );
    }
    validateJsonValue(nested, depth + 1, ancestors);
  }
  ancestors.delete(value);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > NOTIFICATION_PAYLOAD_MAX_BYTES) {
    throw new NotificationInvalidInputError(
      'Notification payload exceeds the size limit.',
    );
  }
}

function validateJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    if (
      typeof value === 'string' &&
      value.length > NOTIFICATION_PAYLOAD_STRING_MAX_LENGTH
    ) {
      throw new NotificationInvalidInputError(
        'Notification payload string is too long.',
      );
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NotificationInvalidInputError(
        'Notification payload numbers must be finite.',
      );
    }
    return;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new NotificationInvalidInputError(
      'Notification payload must be JSON-safe.',
    );
  }
  if (Array.isArray(value)) {
    if (value.length > NOTIFICATION_PAYLOAD_MAX_ARRAY_ITEMS) {
      throw new NotificationInvalidInputError(
        'Notification payload array is too large.',
      );
    }
    for (const item of value) validateJsonValue(item, depth, ancestors);
    return;
  }
  validatePayload(value, depth, ancestors);
}
