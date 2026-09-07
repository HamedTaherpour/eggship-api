import { Injectable } from '@nestjs/common';
import {
  normalizeRegistration,
  type PushInstallationRecord,
  type RegisterPushInstallationInput,
} from '../domain/push-installation';
import { PushInstallationRepository } from '../infrastructure/push-installation.repository';

@Injectable()
export class PushInstallationService {
  constructor(private readonly installations: PushInstallationRepository) {}

  register(
    userId: string,
    input: RegisterPushInstallationInput,
  ): Promise<PushInstallationRecord> {
    return this.installations.register(userId, normalizeRegistration(input));
  }

  revoke(userId: string, installationId: string): Promise<void> {
    return this.installations.revokeOwned(userId, installationId);
  }

  revokeAll(userId: string): Promise<number> {
    return this.installations.revokeAllOwned(userId);
  }

  listEligible(userId: string): Promise<PushInstallationRecord[]> {
    return this.installations.findEligible(userId);
  }

  invalidate(id: string): Promise<void> {
    return this.installations.invalidate(id);
  }

  listAndroidWebOnlyUserIds(): Promise<string[]> {
    return this.installations.findAndroidWebOnlyUserIds();
  }
}
