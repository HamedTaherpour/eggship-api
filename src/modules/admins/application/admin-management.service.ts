import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  isCriticalAdminRole,
  AdminRole,
} from '../../../common/authz/admin-role';
import {
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';
import { AuditLogService } from '../../audit/application/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../audit/domain/audit-event';
import { AdminAuthSessionRepository } from '../../auth/infrastructure/admin-auth-session.repository';
import type { AdminRecord } from '../domain/admin';
import {
  AdminLastSuperAdminProtectedError,
  AdminNotFoundError,
  AdminSelfMutationError,
} from '../domain/admin-errors';
import {
  AdminIdentityService,
  type CreateAdminIdentityInput,
} from './admin-identity.service';
import { AdminRepository } from '../infrastructure/admin.repository';

@Injectable()
export class AdminManagementService {
  constructor(
    private readonly admins: AdminRepository,
    private readonly identity: AdminIdentityService,
    @Inject(forwardRef(() => AdminAuthSessionRepository))
    private readonly sessions: AdminAuthSessionRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  list(
    input: Parameters<AdminRepository['list']>[0],
  ): ReturnType<AdminRepository['list']> {
    return this.admins.list(input);
  }

  async get(id: string): Promise<AdminRecord> {
    const admin = await this.admins.findById(id);
    if (admin === null) throw new AdminNotFoundError();
    return admin;
  }

  async create(
    input: CreateAdminIdentityInput,
    actorId: string,
  ): Promise<AdminRecord> {
    return this.identity.createAdmin(input, undefined, actorId);
  }

  async changeRole(
    id: string,
    role: AdminRole,
    actorId: string,
  ): Promise<AdminRecord> {
    if (id === actorId) throw new AdminSelfMutationError('role change');
    return this.transactions.run(async (tx) => {
      await this.admins.lockManagementScope(tx);
      const current = await this.requireInTransaction(id, tx);
      if (current.role === role) return current;
      if (
        isCriticalAdminRole(current.role) &&
        current.isActive &&
        !isCriticalAdminRole(role)
      ) {
        if ((await this.admins.countActiveSuperAdmins(tx)) <= 1) {
          throw new AdminLastSuperAdminProtectedError();
        }
      }
      const updated = await this.admins.updateRole(id, role, tx);
      await this.sessions.revokeAllAdminSessions(id, new Date(), tx);
      await this.audit.append(
        {
          action: AuditAction.ADMIN_ROLE_CHANGED,
          actorType: AuditActorType.ADMIN,
          actorId,
          entityType: AuditEntityType.ADMIN,
          entityId: id,
          metadata: {
            changedFields: ['role'],
            oldRole: current.role,
            newRole: role,
          },
        },
        tx,
      );
      return updated;
    });
  }

  async setActive(
    id: string,
    active: boolean,
    actorId: string,
  ): Promise<AdminRecord> {
    if (!active && id === actorId) throw new AdminSelfMutationError('disable');
    return this.transactions.run(async (tx) => {
      await this.admins.lockManagementScope(tx);
      const current = await this.requireInTransaction(id, tx);
      if (current.isActive === active) return current;
      if (
        !active &&
        isCriticalAdminRole(current.role) &&
        (await this.admins.countActiveSuperAdmins(tx)) <= 1
      ) {
        throw new AdminLastSuperAdminProtectedError();
      }
      const updated = await this.admins.updateActive(id, active, tx);
      if (!active)
        await this.sessions.revokeAllAdminSessions(id, new Date(), tx);
      await this.audit.append(
        {
          action: active
            ? AuditAction.ADMIN_ENABLED
            : AuditAction.ADMIN_DISABLED,
          actorType: AuditActorType.ADMIN,
          actorId,
          entityType: AuditEntityType.ADMIN,
          entityId: id,
          metadata: undefined,
        },
        tx,
      );
      return updated;
    });
  }

  private async requireInTransaction(
    id: string,
    tx: TransactionContext,
  ): Promise<AdminRecord> {
    const admin = await this.admins.findByIdInTransaction(id, tx);
    if (admin === null) throw new AdminNotFoundError();
    return admin;
  }
}
