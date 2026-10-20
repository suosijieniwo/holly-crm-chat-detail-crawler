import { describe, expect, it } from "vitest";

import type { Clock } from "../../src/domain/types.js";
import { GlobalStartRateLimiter } from "../../src/jobs/rate-limiter.js";

class FakeClock implements Clock {
  value = 0;
  sleeps: number[] = [];

  now(): number {
    return this.value;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.value += ms;
  }
}

describe("GlobalStartRateLimiter", () => {
  it("并发 worker 的任意请求启动仍至少间隔500毫秒", async () => {
    const clock = new FakeClock();
    const limiter = new GlobalStartRateLimiter(500, clock);
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        await limiter.acquire();
      })
    );

    expect(clock.sleeps).toEqual([500, 500, 500]);
    expect(clock.now()).toBe(1500);
  });
});
