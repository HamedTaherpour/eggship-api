import { Injectable } from '@nestjs/common';
import { requireCustomerOwnerId } from '../../../common/authz/resource-ownership';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { AuthError } from '../../auth/domain/auth-error';
import { AuthErrorCode } from '../../auth/domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../../auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { UserRecord } from '../domain/user';
import { UserRepository } from '../infrastructure/user.repository';

export interface CustomerProfileView {
  id: string;
  phone: string;
  isActive: boolean;
  profileComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Current-user profile reads/updates for the authenticated storefront subject.
 * Identity always comes from the access-token principal — never from client ids.
 */
@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly users: UserRepository,
    private readonly logger: ApplicationLogger,
  ) {}

  async getCurrentProfile(
    principal: AuthenticatedPrincipal,
  ): Promise<CustomerProfileView> {
    const user = await this.requireActiveUser(principal);
    return toProfileView(user);
  }

  /**
   * AUTH-07: no evidenced mutable business profile fields yet (MIG-01 pending).
   * Accepts an empty allowlisted body only; rejects unknown fields at the DTO boundary.
   * Phone, isActive, and ids are never mutable here.
   */
  async updateCurrentProfile(
    principal: AuthenticatedPrincipal,
  ): Promise<CustomerProfileView> {
    const user = await this.requireActiveUser(principal);

    this.logger.info(
      {
        module: 'users',
        operation: 'user.profile.updated',
        subjectType: AuthSubjectType.USER,
        subjectId: user.id,
        fieldsUpdated: [],
      },
      'Customer profile update acknowledged (no mutable business fields yet)',
    );

    return toProfileView(user);
  }

  private async requireActiveUser(
    principal: AuthenticatedPrincipal,
  ): Promise<UserRecord> {
    const ownerId = requireCustomerOwnerId(principal);
    const user = await this.users.findById(ownerId);
    if (user === null) {
      throw new AuthError(
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    if (!user.isActive) {
      throw new AuthError(
        AuthErrorCode.ACCOUNT_DISABLED,
        'Account is disabled.',
      );
    }
    return user;
  }
}

function toProfileView(user: UserRecord): CustomerProfileView {
  return {
    id: user.id,
    phone: user.phone,
    isActive: user.isActive,
    profileComplete: true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
