import type { Clock } from "../domain/types.js";

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
};

export class GlobalStartRateLimiter {
  private nextAllowedAt = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly clock: Clock = systemClock
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("限速间隔无效");
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      signal?.throwIfAborted();
      const wait = Math.max(0, this.nextAllowedAt - this.clock.now());
      if (wait > 0) await this.clock.sleep(wait, signal);
      const startedAt = this.clock.now();
      this.nextAllowedAt = startedAt + this.intervalMs;
    } finally {
      release();
    }
  }
}
