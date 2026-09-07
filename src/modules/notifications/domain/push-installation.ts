import { ApplicationError } from '../../../common/errors/application-error';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_MAX_LENGTH = 512;

export const PushInstallationStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  INVALIDATED: 'INVALIDATED',
} as const;
export type PushInstallationStatus =
  (typeof PushInstallationStatus)[keyof typeof PushInstallationStatus];

export const PushChannel = {
  WEB_PUSH: 'WEB_PUSH',
  NATIVE_PUSH: 'NATIVE_PUSH',
} as const;
export type PushChannel = (typeof PushChannel)[keyof typeof PushChannel];

export const PushOs = {
  ANDROID: 'ANDROID',
  WINDOWS: 'WINDOWS',
  MACOS: 'MACOS',
  IOS: 'IOS',
  LINUX: 'LINUX',
  OTHER: 'OTHER',
} as const;
export type PushOs = (typeof PushOs)[keyof typeof PushOs];

export interface RegisterPushInstallationInput {
  installationId: string;
  providerToken: string;
  permissionGranted: boolean;
  channel: PushChannel;
  os: PushOs;
}

export interface PushInstallationRecord extends Omit<
  RegisterPushInstallationInput,
  'channel' | 'os'
> {
  id: string;
  userId: string;
  status: PushInstallationStatus;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  channel: PushChannel | null;
  os: PushOs | null;
}

export class PushInstallationInvalidInputError extends ApplicationError {
  constructor(message: string) {
    super('NOTIFICATION_INSTALLATION_INVALID', message);
  }
}

export class PushInstallationOwnershipError extends ApplicationError {
  constructor() {
    super(
      'NOTIFICATION_INSTALLATION_NOT_FOUND',
      'Notification installation was not found.',
      404,
    );
  }
}

export class PushInstallationActiveConflictError extends ApplicationError {
  constructor() {
    super(
      'NOTIFICATION_INSTALLATION_CONFLICT',
      'Notification installation cannot be assigned.',
      409,
    );
  }
}

export function normalizeRegistration(
  input: RegisterPushInstallationInput,
): RegisterPushInstallationInput {
  if (!UUID.test(input.installationId))
    throw new PushInstallationInvalidInputError(
      'installationId must be a UUID.',
    );
  if (
    typeof input.providerToken !== 'string' ||
    input.providerToken.length < 1 ||
    input.providerToken.length > TOKEN_MAX_LENGTH
  ) {
    throw new PushInstallationInvalidInputError(
      'providerToken must be non-empty and at most 512 characters.',
    );
  }
  if (typeof input.permissionGranted !== 'boolean')
    throw new PushInstallationInvalidInputError(
      'permissionGranted must be boolean.',
    );
  if (!Object.values(PushChannel).includes(input.channel))
    throw new PushInstallationInvalidInputError('channel is invalid.');
  if (!Object.values(PushOs).includes(input.os))
    throw new PushInstallationInvalidInputError('os is invalid.');
  return {
    installationId: input.installationId.toLowerCase(),
    providerToken: input.providerToken,
    permissionGranted: input.permissionGranted,
    channel: input.channel,
    os: input.os,
  };
}
