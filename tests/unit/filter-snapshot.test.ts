import { describe, expect, it } from "vitest";

import { createFilterSnapshot } from "../../src/query/filter-snapshot.js";

describe("createFilterSnapshot", () => {
  it("排除页码并对相同筛选生成稳定指纹", () => {
    const first = createFilterSnapshot(
      { Status: "finish", ChannelId: ["web"], page: 1, limit: 20 },
      "2026-08-26T09:00:00.000Z"
    );
    const second = createFilterSnapshot(
      { limit: 20, page: 9, ChannelId: ["web"], Status: "finish" },
      "2026-08-26T09:10:00.000Z"
    );

    expect(first.canonicalConditions).toEqual({ ChannelId: ["web"], Status: "finish" });
    expect(first.pageSize).toBe(20);
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
