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

export interface RegisterPushInstallationInput {
  installationId: string;
  providerToken: string;
  permissionGranted: boolean;
}

export interface PushInstallationRecord extends RegisterPushInstallationInput {
  id: string;
  userId: string;
  status: PushInstallationStatus;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
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
  return {
    installationId: input.installationId.toLowerCase(),
    providerToken: input.providerToken,
    permissionGranted: input.permissionGranted,
  };
}
