import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole } from '../../../common/authz/admin-role';
import { ApplicationLogger } from '../../../common/observability/application-logger.service';
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
import { PASSWORD_HASHER } from '../../auth/auth.tokens';
import type { PasswordHasher } from '../../auth/domain/password-hasher';
import type { AdminLoginCredential, AdminRecord } from '../domain/admin';
import { normalizeAdminEmail } from '../domain/admin-email';
import { assertAdminPasswordPolicy } from '../domain/admin-password-policy';
import { AdminRepository } from '../infrastructure/admin.repository';

export interface CreateAdminIdentityInput {
  email: string;
  password: string;
  role: AdminRole;
}

/**
 * Creates Admin identities: canonical email, hashed credential, persisted role.
 *
 * HTTP login lives in Auth (`AdminLoginService`). This service remains the
 * only creation path. The operator CLI (`pnpm admin:create`) is the explicit
 * bootstrap caller; there is still no HTTP create-admin endpoint, no default
 * credential, and no automatic provisioning at startup.
 *
 * Password hashing goes through the `PasswordHasher` port (Argon2id, AUTH-03).
 * Admin must not import Argon2 directly or define a second hashing policy.
 */
@Injectable()
export class AdminIdentityService {
  constructor(
    private readonly admins: AdminRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasher,
    private readonly logger: ApplicationLogger,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Validates, hashes, and persists. Throws `AdminEmailAlreadyExistsError` when
   * the canonical email is taken, including when a concurrent request won the
   * race — the database unique index is the authority, not a prior read.
   */
  async createAdmin(
    input: CreateAdminIdentityInput,
    existingTx?: TransactionContext,
    actorId?: string,
  ): Promise<AdminRecord> {
    const email = normalizeAdminEmail(input.email);
    // Validate before hashing: rejecting a weak password should not pay for an
    // Argon2 hash first.
    assertAdminPasswordPolicy(input.password);

    const passwordHash = await this.passwords.hash(input.password);
    const admin = await this.transactions.runIn(existingTx, async (tx) => {
      const created = await this.admins.create(
        { email, passwordHash, role: input.role },
        tx,
      );
      await this.audit.append(
        {
          action: AuditAction.ADMIN_IDENTITY_CREATED,
          actorType:
            actorId === undefined
              ? AuditActorType.SYSTEM
              : AuditActorType.ADMIN,
          actorId: actorId ?? null,
          entityType: AuditEntityType.ADMIN,
          entityId: created.id,
          metadata: undefined,
        },
        tx,
      );
      return created;
    });

    this.logger.info(
      {
        module: 'admins',
        operation: 'admin.identity.created',
        adminId: admin.id,
        role: admin.role,
      },
      'Admin identity created',
    );

    return admin;
  }

  async findById(id: string): Promise<AdminRecord | null> {
    return this.admins.findById(id);
  }

  /**
   * Credential read for password login. Returns null when the identifier is
   * not an existing Admin. Does not log the email or hash.
   */
  async findLoginCredential(
    email: string,
  ): Promise<AdminLoginCredential | null> {
    return this.admins.findLoginCredentialByEmail(email);
  }
}
