import { ApplicationError } from '../../../common/errors/application-error';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationDestination = { type: 'ORDER'; id: string };

export function validateNotificationDestination(
  value: unknown,
): NotificationDestination {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ApplicationError(
      'NOTIFICATION_DESTINATION_INVALID',
      'Notification destination is invalid.',
    );
  const candidate = value as Record<string, unknown>;
  if (
    candidate['type'] !== 'ORDER' ||
    typeof candidate['id'] !== 'string' ||
    !UUID.test(candidate['id'])
  ) {
    throw new ApplicationError(
      'NOTIFICATION_DESTINATION_INVALID',
      'Notification destination is invalid.',
    );
  }
  return { type: 'ORDER', id: candidate['id'].toLowerCase() };
}
