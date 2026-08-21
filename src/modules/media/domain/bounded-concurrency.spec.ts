import { mapWithBoundedConcurrency } from './bounded-concurrency';

describe('mapWithBoundedConcurrency', () => {
  it('never runs more than the configured number of active tasks', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];

    const results = await mapWithBoundedConcurrency(items, 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await new Promise((resolve) => {
        setTimeout(resolve, 15);
      });
      active -= 1;
      return value * 10;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
  });
});
