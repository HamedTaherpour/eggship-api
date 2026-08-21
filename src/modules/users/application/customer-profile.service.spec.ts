import { randomUUID } from 'node:crypto';
import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { AuthErrorCode } from '../../auth/domain/auth-error-codes';
import { AuthSubjectType } from '../../auth/domain/subject-type';
import type { UserRecord } from '../domain/user';
import type { UserRepository } from '../infrastructure/user.repository';
import { CustomerProfileService } from './customer-profile.service';

describe('CustomerProfileService', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const userId = randomUUID();

  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: CustomerProfileService;

  beforeEach(() => {
    users = { findById: jest.fn() };
    logger = { info: jest.fn() };
    service = new CustomerProfileService(
      users as unknown as UserRepository,
      logger as unknown as ApplicationLogger,
    );
  });

  function user(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
      id: userId,
      phone: '+989121234567',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('returns the authenticated user profile', async () => {
    users.findById.mockResolvedValue(user());
    const profile = await service.getCurrentProfile({
      subjectId: userId,
      subjectType: AuthSubjectType.USER,
      sessionId: randomUUID(),
    });
    expect(profile.id).toBe(userId);
    expect(profile.phone).toBe('+989121234567');
    expect(profile.profileComplete).toBe(true);
  });

  it('rejects inactive users', async () => {
    users.findById.mockResolvedValue(user({ isActive: false }));
    await expect(
      service.getCurrentProfile({
        subjectId: userId,
        subjectType: AuthSubjectType.USER,
        sessionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: AuthErrorCode.ACCOUNT_DISABLED });
  });

  it('updates with an empty allowlist without mutating identity fields', async () => {
    users.findById.mockResolvedValue(user());
    const profile = await service.updateCurrentProfile({
      subjectId: userId,
      subjectType: AuthSubjectType.USER,
      sessionId: randomUUID(),
    });
    expect(profile.phone).toBe('+989121234567');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'user.profile.updated',
        subjectId: userId,
        fieldsUpdated: [],
      }),
      expect.any(String),
    );
  });
});
