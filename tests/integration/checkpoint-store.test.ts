import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { JobCheckpoint } from "../../src/domain/types.js";
import { FileJobStore } from "../../src/jobs/checkpoint-store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sample(): JobCheckpoint {
  return {
    version: 1,
    jobId: "fictional-job",
    filter: {
      canonicalConditions: { Status: "finish" },
      sort: [],
      pageSize: 10,
      fingerprint: "fp-1",
      capturedAt: "2026-08-26T09:00:00.000Z"
    },
    conversations: [],
    completedConversationIds: [],
    results: {},
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z"
  };
}

describe("FileJobStore", () => {
  it("原子保存并只恢复同筛选指纹的任务", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "chat-export-job-"));
    dirs.push(dir);
    const store = new FileJobStore(dir);
    await store.save(sample());

    expect(readdirSync(dir)).toEqual(["fictional-job.json"]);
    expect((await store.loadResumable("fp-1"))?.jobId).toBe("fictional-job");
    expect(await store.loadResumable("different")).toBeUndefined();

    await store.remove("fictional-job");
    expect(readdirSync(dir)).toEqual([]);
  });
});
