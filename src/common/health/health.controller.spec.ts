import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';

const logger = { warn: jest.fn() } as never;

describe('HealthController', () => {
  it('returns an ok status wrapped in the API data envelope', () => {
    const controller = new HealthController(
      new ConfigService({ APP_VERSION: '0.1.0-test' }),
      { $queryRaw: jest.fn() } as never,
      { readiness: jest.fn() } as never,
      { isAcceptingTraffic: () => true } as never,
      logger,
    );

    expect(controller.check()).toEqual({
      data: { status: 'ok', version: '0.1.0-test' },
    });
  });

  function createController(
    postgresReady: boolean,
    redisState = { configured: false, ready: false },
  ): HealthController {
    const controller = new HealthController(
      new ConfigService({ APP_VERSION: '0.1.0-test' }),
      {
        $queryRaw: postgresReady
          ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
          : jest
              .fn()
              .mockRejectedValue(
                new Error('secret postgres connection string'),
              ),
      } as never,
      { readiness: jest.fn().mockResolvedValue(redisState) } as never,
      { isAcceptingTraffic: () => true } as never,
      logger,
    );
    return controller;
  }

  it('keeps liveness independent from dependency state', () => {
    expect(createController(false).check()).toEqual({
      data: { status: 'ok', version: '0.1.0-test' },
    });
  });

  it('reports readiness success and disables optional Redis safely', async () => {
    const response = { status: jest.fn() };
    await expect(
      createController(true).readiness(response as never),
    ).resolves.toEqual({
      data: {
        status: 'ready',
        version: '0.1.0-test',
        checks: { postgres: 'ready', redis: 'disabled' },
      },
    });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('returns not ready without leaking dependency errors', async () => {
    const response = { status: jest.fn() };
    const result = await createController(false, {
      configured: true,
      ready: false,
    }).readiness(response as never);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(result).toEqual({
      data: {
        status: 'not_ready',
        version: '0.1.0-test',
        checks: { postgres: 'not_ready', redis: 'not_ready' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports Redis readiness when configured', async () => {
    const response = { status: jest.fn() };
    await expect(
      createController(true, { configured: true, ready: true }).readiness(
        response as never,
      ),
    ).resolves.toMatchObject({
      data: { status: 'ready', checks: { redis: 'ready' } },
    });
  });
});
