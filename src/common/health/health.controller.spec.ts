import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns an ok status wrapped in the API data envelope', () => {
    const controller = new HealthController(
      new ConfigService({ APP_VERSION: '0.1.0-test' }),
    );

    expect(controller.check()).toEqual({
      data: { status: 'ok', version: '0.1.0-test' },
    });
  });
});
