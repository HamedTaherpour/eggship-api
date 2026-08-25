import type { ApplicationLogger } from '../../../common/observability/application-logger.service';
import { CommerceOverrideMode } from '../domain/commerce-policy';
import {
  CommerceOverrideInvalidError,
  CommercePolicyInvalidSettingsError,
  CommercePolicyRevisionConflictError,
} from '../domain/commerce-policy-errors';
import type { CommercePolicyRepository } from '../infrastructure/commerce-policy.repository';
import { CommercePolicyService } from './commerce-policy.service';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-25T10:00:00.000Z');
const settings = {
  orderingScheduleEnabled: true,
  orderingOpensAtLocalMinute: 420,
  orderingClosesAtLocalMinute: 960,
  minimumOrderQuantity: 5,
  revision: 1,
  createdByAdminId: ACTOR,
  updatedByAdminId: ACTOR,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('CommercePolicyService', () => {
  let repository: jest.Mocked<CommercePolicyRepository>;
  let logger: jest.Mocked<Pick<ApplicationLogger, 'info'>>;
  let service: CommercePolicyService;

  beforeEach(() => {
    repository = {
      getSettings: jest.fn(),
      listOverrides: jest.fn(),
      initialize: jest.fn(),
      updateSettings: jest.fn(),
      putOverride: jest.fn(),
      removeOverride: jest.fn(),
    } as unknown as jest.Mocked<CommercePolicyRepository>;
    logger = { info: jest.fn() };
    service = new CommercePolicyService(
      repository,
      logger as unknown as ApplicationLogger,
    );
  });

  it('initializes expected revision 0 as revision 1 and records the authenticated actor', async () => {
    repository.initialize.mockResolvedValue(settings);
    await expect(
      service.initialize(
        {
          orderingScheduleEnabled: true,
          orderingOpensAtLocalMinute: 420,
          orderingClosesAtLocalMinute: 960,
          minimumOrderQuantity: 5,
        },
        0,
        ACTOR,
      ),
    ).resolves.toEqual(settings);
    expect(repository.initialize.mock.calls[0]).toEqual([
      expect.any(Object),
      ACTOR,
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'commerce.settings.created',
        actorId: ACTOR,
        revision: 1,
      }),
      expect.any(String),
    );
  });

  it('rejects nonzero initialization revision without inventing a current policy', async () => {
    repository.getSettings.mockResolvedValue(null);
    await expect(
      service.initialize(
        {
          orderingScheduleEnabled: true,
          orderingOpensAtLocalMinute: 420,
          orderingClosesAtLocalMinute: 960,
          minimumOrderQuantity: 5,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommercePolicyRevisionConflictError);
  });

  it('accepts cross-midnight and disabled always-open regular schedules', async () => {
    repository.updateSettings.mockResolvedValue({
      settings: { ...settings, revision: 2 },
      changed: true,
    });
    await expect(
      service.update(
        {
          orderingScheduleEnabled: false,
          orderingOpensAtLocalMinute: 1080,
          orderingClosesAtLocalMinute: 120,
          minimumOrderQuantity: 9,
        },
        1,
        ACTOR,
      ),
    ).resolves.toMatchObject({ settings: { revision: 2 } });
  });

  it('rejects equal regular times and invalid minimum quantities', async () => {
    await expect(
      service.update(
        {
          orderingScheduleEnabled: true,
          orderingOpensAtLocalMinute: 420,
          orderingClosesAtLocalMinute: 420,
          minimumOrderQuantity: 1,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommercePolicyInvalidSettingsError);
    await expect(
      service.update(
        {
          orderingScheduleEnabled: true,
          orderingOpensAtLocalMinute: 420,
          orderingClosesAtLocalMinute: 960,
          minimumOrderQuantity: 0,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommercePolicyInvalidSettingsError);
  });

  it('accepts CLOSED and SPECIAL_HOURS shapes and delegates the expected revision', async () => {
    repository.putOverride.mockResolvedValue({
      settings: { ...settings, revision: 2 },
      changed: true,
      action: 'created',
      override: {
        id: ACTOR,
        localDate: '2026-08-25',
        mode: CommerceOverrideMode.CLOSED,
        opensAtLocalMinute: null,
        closesAtLocalMinute: null,
        createdByAdminId: ACTOR,
        updatedByAdminId: ACTOR,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await service.putOverride(
      '2026-08-25',
      {
        mode: CommerceOverrideMode.CLOSED,
        opensAtLocalMinute: null,
        closesAtLocalMinute: null,
      },
      1,
      ACTOR,
    );
    expect(repository.putOverride.mock.calls[0]).toEqual([
      '2026-08-25',
      expect.any(Object),
      1,
      ACTOR,
    ]);

    repository.putOverride.mockResolvedValue({
      settings: { ...settings, revision: 3 },
      changed: true,
      action: 'updated',
      override: {
        id: ACTOR,
        localDate: '2026-08-25',
        mode: CommerceOverrideMode.SPECIAL_HOURS,
        opensAtLocalMinute: 1080,
        closesAtLocalMinute: 120,
        createdByAdminId: ACTOR,
        updatedByAdminId: ACTOR,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    await expect(
      service.putOverride(
        '2026-08-25',
        {
          mode: CommerceOverrideMode.SPECIAL_HOURS,
          opensAtLocalMinute: 1080,
          closesAtLocalMinute: 120,
        },
        2,
        ACTOR,
      ),
    ).resolves.toMatchObject({ settings: { revision: 3 } });
  });

  it('rejects invalid mode/hour combinations and invalid local dates', async () => {
    await expect(
      service.putOverride(
        '2026-02-30',
        {
          mode: CommerceOverrideMode.CLOSED,
          opensAtLocalMinute: null,
          closesAtLocalMinute: null,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommerceOverrideInvalidError);
    await expect(
      service.putOverride(
        '2026-08-25',
        {
          mode: CommerceOverrideMode.CLOSED,
          opensAtLocalMinute: 60,
          closesAtLocalMinute: null,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommerceOverrideInvalidError);
    await expect(
      service.putOverride(
        '2026-08-25',
        {
          mode: CommerceOverrideMode.SPECIAL_HOURS,
          opensAtLocalMinute: 60,
          closesAtLocalMinute: 60,
        },
        1,
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CommerceOverrideInvalidError);
  });

  it('removes an override with actor-safe expected-revision delegation', async () => {
    repository.removeOverride.mockResolvedValue({
      settings: { ...settings, revision: 2 },
      changed: true,
    });
    await service.removeOverride('2026-08-25', 1, ACTOR);
    expect(repository.removeOverride.mock.calls[0]).toEqual([
      '2026-08-25',
      1,
      ACTOR,
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'commerce.schedule_override.removed',
        actorId: ACTOR,
        previousRevision: 1,
        revision: 2,
      }),
      expect.any(String),
    );
  });
});
