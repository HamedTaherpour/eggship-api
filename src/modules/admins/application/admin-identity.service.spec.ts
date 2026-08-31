import { randomUUID } from 'node:crypto';
import { AdminRole } from '../../../common/authz/admin-role';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import {
  TRANSACTION_CONTEXT_BRAND,
  TransactionRunner,
  type TransactionContext,
} from '../../../infrastructure/database/transaction';
import type { AuditLogService } from '../../audit/application/audit-log.service';
import type { PasswordHasher } from '../../auth/domain/password-hasher';
import type { AdminRecord, CreateAdminInput } from '../domain/admin';
import { InvalidAdminEmailError } from '../domain/admin-email';
import { AdminEmailAlreadyExistsError } from '../domain/admin-errors';
import { WeakAdminPasswordError } from '../domain/admin-password-policy';
import type { AdminRepository } from '../infrastructure/admin.repository';
import { AdminIdentityService } from './admin-identity.service';

const STRONG_PASSWORD = 'correct horse battery staple';

describe('AdminIdentityService', () => {
  class ImmediateTransactionRunner extends TransactionRunner {
    run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return fn({ [TRANSACTION_CONTEXT_BRAND]: true });
    }
    runIn<T>(
      existing: TransactionContext | undefined,
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> {
      return fn(existing ?? { [TRANSACTION_CONTEXT_BRAND]: true });
    }
    runSnapshotRead<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return this.run(fn);
    }
    runRepeatableRead<T>(
      fn: (tx: TransactionContext) => Promise<T>,
    ): Promise<T> {
      return this.run(fn);
    }
  }
  let create: jest.Mock<Promise<AdminRecord>, [CreateAdminInput]>;
  let hash: jest.Mock<Promise<string>, [string]>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: AdminIdentityService;

  beforeEach(() => {
    create = jest.fn((input: CreateAdminInput): Promise<AdminRecord> =>
      Promise.resolve({
        id: randomUUID(),
        email: input.email,
        role: input.role,
        isActive: input.isActive ?? true,
        createdAt: new Date('2026-08-21T00:00:00.000Z'),
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      }),
    );
    hash = jest.fn((password: string) =>
      Promise.resolve(`$argon2id$digest-of-${password.length}-chars`),
    );
    logger = { info: jest.fn() };

    service = new AdminIdentityService(
      { create } as unknown as AdminRepository,
      { hash } as unknown as PasswordHasher,
      logger as unknown as ApplicationLogger,
      new ImmediateTransactionRunner(),
      {
        append: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogService,
    );
  });

  it('persists the canonical email and the persisted role', async () => {
    const admin = await service.createAdmin({
      email: '  Ops.Lead@EggShip.Test ',
      password: STRONG_PASSWORD,
      role: AdminRole.WAREHOUSE,
    });

    expect(admin.email).toBe('ops.lead@eggship.test');
    expect(admin.role).toBe(AdminRole.WAREHOUSE);
    expect(admin.isActive).toBe(true);
  });

  it('stores a hash from the shared password hasher and never the plaintext', async () => {
    await service.createAdmin({
      email: 'ops@example.com',
      password: STRONG_PASSWORD,
      role: AdminRole.ORDER_OPS,
    });

    expect(hash).toHaveBeenCalledWith(STRONG_PASSWORD);
    const persisted = create.mock.calls[0]?.[0];
    expect(persisted?.passwordHash).toBe(
      `$argon2id$digest-of-${STRONG_PASSWORD.length}-chars`,
    );
    expect(JSON.stringify(persisted)).not.toContain(STRONG_PASSWORD);
  });

  it('rejects a weak password before doing any hashing work', async () => {
    await expect(
      service.createAdmin({
        email: 'ops@example.com',
        password: 'short',
        role: AdminRole.SUPER_ADMIN,
      }),
    ).rejects.toBeInstanceOf(WeakAdminPasswordError);

    expect(hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a non-canonicalizable email before hashing or persisting', async () => {
    await expect(
      service.createAdmin({
        email: 'ops@localhost',
        password: STRONG_PASSWORD,
        role: AdminRole.SUPER_ADMIN,
      }),
    ).rejects.toBeInstanceOf(InvalidAdminEmailError);

    expect(hash).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces the persistence conflict when the canonical email is taken', async () => {
    create.mockRejectedValueOnce(new AdminEmailAlreadyExistsError());

    await expect(
      service.createAdmin({
        email: 'ops@example.com',
        password: STRONG_PASSWORD,
        role: AdminRole.ORDER_OPS,
      }),
    ).rejects.toBeInstanceOf(AdminEmailAlreadyExistsError);
  });

  it('logs creation without the email, password, or hash', async () => {
    const admin = await service.createAdmin({
      email: 'ops@example.com',
      password: STRONG_PASSWORD,
      role: AdminRole.SUPER_ADMIN,
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        module: 'admins',
        operation: 'admin.identity.created',
        adminId: admin.id,
        role: AdminRole.SUPER_ADMIN,
      },
      'Admin identity created',
    );
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('ops@example.com');
    expect(logged).not.toContain(STRONG_PASSWORD);
    expect(logged).not.toContain('$argon2id$');
  });
});
