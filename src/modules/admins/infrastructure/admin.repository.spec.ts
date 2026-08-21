import { ALL_ADMIN_ROLES } from '../../../common/authz/admin-role';
import { AdminRole as PrismaAdminRole } from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { AdminEmailAlreadyExistsError } from '../domain/admin-errors';
import { InvalidAdminEmailError } from '../domain/admin-email';
import { AdminRepository } from './admin.repository';

interface AdminDelegateStub {
  create: jest.Mock;
  findUnique: jest.Mock;
}

function createRepository(delegate: AdminDelegateStub): AdminRepository {
  return new AdminRepository({ admin: delegate } as unknown as PrismaService);
}

function adminRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ops@example.com',
    role: PrismaAdminRole.WAREHOUSE,
    isActive: true,
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminRepository', () => {
  let delegate: AdminDelegateStub;
  let repository: AdminRepository;

  beforeEach(() => {
    delegate = { create: jest.fn(), findUnique: jest.fn() };
    repository = createRepository(delegate);
  });

  it('persists only the canonical email', async () => {
    delegate.create.mockResolvedValue(adminRow());

    await repository.create({
      email: '  Ops@Example.COM ',
      passwordHash: '$argon2id$fake',
      role: 'WAREHOUSE',
    });

    expect(delegate.create).toHaveBeenCalledWith({
      data: {
        email: 'ops@example.com',
        passwordHash: '$argon2id$fake',
        role: 'WAREHOUSE',
        isActive: true,
      },
    });
  });

  it('refuses to persist an email that cannot be canonicalized', async () => {
    await expect(
      repository.create({
        email: 'not-an-email',
        passwordHash: '$argon2id$fake',
        role: 'WAREHOUSE',
      }),
    ).rejects.toThrow(InvalidAdminEmailError);
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('translates a unique-constraint failure into a domain conflict', async () => {
    delegate.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    );

    await expect(
      repository.create({
        email: 'ops@example.com',
        passwordHash: '$argon2id$fake',
        role: 'ORDER_OPS',
      }),
    ).rejects.toBeInstanceOf(AdminEmailAlreadyExistsError);
  });

  it('propagates unrelated persistence failures unchanged', async () => {
    delegate.create.mockRejectedValue(new Error('connection terminated'));

    await expect(
      repository.create({
        email: 'ops@example.com',
        passwordHash: '$argon2id$fake',
        role: 'ORDER_OPS',
      }),
    ).rejects.toThrow(/connection terminated/u);
  });

  it('looks up by the same canonical email regardless of input casing', async () => {
    delegate.findUnique.mockResolvedValue(adminRow());

    const found = await repository.findByEmail('  OPS@Example.com ');

    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { email: 'ops@example.com' },
    });
    expect(found?.email).toBe('ops@example.com');
  });

  it('returns null without querying when the email cannot be canonicalized', async () => {
    expect(await repository.findByEmail('ops@localhost')).toBeNull();
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it('never exposes the password hash on an identity record', async () => {
    delegate.create.mockResolvedValue(
      adminRow({ passwordHash: '$argon2id$secret-digest' }),
    );

    const created = await repository.create({
      email: 'ops@example.com',
      passwordHash: '$argon2id$secret-digest',
      role: 'SUPER_ADMIN',
    });

    expect(JSON.stringify(created)).not.toContain('secret-digest');
    expect(Object.keys(created)).not.toContain('passwordHash');
  });

  it('reads authorization state without loading the email', async () => {
    delegate.findUnique.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      role: PrismaAdminRole.SUPER_ADMIN,
      isActive: false,
    });

    const state = await repository.findAuthorizationState(
      '11111111-1111-4111-8111-111111111111',
    );

    expect(delegate.findUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      select: { id: true, role: true, isActive: true },
    });
    expect(state).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'SUPER_ADMIN',
      isActive: false,
    });
  });

  it('returns null for an unknown admin id', async () => {
    delegate.findUnique.mockResolvedValue(null);

    expect(
      await repository.findAuthorizationState(
        '22222222-2222-4222-8222-222222222222',
      ),
    ).toBeNull();
  });
});

describe('persisted admin role enum', () => {
  it('matches the code-defined AdminRole exactly', () => {
    // The database enum is a representation of the code-defined roles, not a
    // second source of truth. Drift in either direction is a defect: a role only
    // in code cannot be stored, and a role only in the database resolves to no
    // permissions.
    expect([...Object.values(PrismaAdminRole)].sort()).toEqual(
      [...ALL_ADMIN_ROLES].sort(),
    );
  });
});
