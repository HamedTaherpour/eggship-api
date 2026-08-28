/**
 * A bounded test-only gate for making a group of independent database
 * operations enter their contended section together. It coordinates promises
 * only; it has no production/runtime dependency and owns no global state.
 */
export class ConcurrencyGate {
  private arrivalCount = 0;
  private releaseGate: (() => void) | undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  constructor(
    private readonly expectedArrivals: number,
    private readonly timeoutMs = 10_000,
  ) {
    if (!Number.isInteger(expectedArrivals) || expectedArrivals < 1) {
      throw new Error(
        'ConcurrencyGate expectedArrivals must be a positive integer.',
      );
    }
  }

  async arriveAndWait(): Promise<void> {
    this.arrivalCount += 1;
    if (this.arrivalCount === this.expectedArrivals) {
      this.release();
    }
    await this.withTimeout(this.released, 'ConcurrencyGate release timeout');
  }

  release(): void {
    this.releaseGate?.();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
