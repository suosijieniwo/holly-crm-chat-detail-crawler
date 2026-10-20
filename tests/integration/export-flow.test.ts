import { describe, expect, it } from "vitest";

import type { JobCheckpoint } from "../../src/domain/types.js";
import type { JobStore } from "../../src/jobs/checkpoint-store.js";
import { runExportFlow, waitForStart } from "../../src/jobs/export-flow.js";

const collected = {
  filter: { canonicalConditions: {}, sort: [], pageSize: 10, fingerprint: "fp", capturedAt: "2026-10-11" },
  conversations: [{ conversationId: "c1", ordinal: 1, summary: {} }]
};

describe("export flow", () => {
  it("旧分类版本的成功断点也重新采集，避免沿用漏掉人工的缓存", async () => {
    const legacy: JobCheckpoint = {
      version: 1, jobId: "legacy", ...collected, completedConversationIds: ["c1"],
      results: { c1: { snapshot: collected.conversations[0]!, messages: [], status: "success", rawUniqueMessageCount: 0 } },
      createdAt: "2026-10-11", updatedAt: "2026-10-11"
    };
    const store: JobStore = { async save() {}, async loadResumable() { return legacy; }, async remove() {} };
    const job = { async start(cp: JobCheckpoint) {
      expect(cp.results.c1?.status).toBe("partial");
      cp.results.c1!.status = "success";
      return cp;
    } };
    await runExportFlow(collected, store, job, { async writeAndFinalize() { return "file.xlsx"; } });
  });
  it.each(["success", "partial", "failed"] as const)("%s 写出后只清理全部成功任务", async status => {
    let removed = false;
    let saved: JobCheckpoint | undefined;
    const store: JobStore = { async save(cp) { saved = structuredClone(cp); }, async loadResumable() { return undefined; }, async remove() { removed = true; } };
    const job = { async start(cp: JobCheckpoint) {
      cp.results.c1 = { snapshot: cp.conversations[0]!, messages: [], status, rawUniqueMessageCount: 0 };
      cp.completedConversationIds = ["c1"];
      return cp;
    } };
    const result = await runExportFlow(collected, store, job, { async writeAndFinalize() { return "file.xlsx"; } });
    expect(result.complete).toBe(status === "success");
    expect(removed).toBe(status === "success");
    if (status !== "success") expect(saved?.results.c1?.status).toBe(status);
  });

  it("Excel 写出异常保留最新断点并报告实际错误", async () => {
    let saved: JobCheckpoint | undefined;
    const store: JobStore = { async save(cp) { saved = structuredClone(cp); }, async loadResumable() { return undefined; }, async remove() { throw new Error("不应删除"); } };
    const job = { async start(cp: JobCheckpoint) {
      cp.results.c1 = { snapshot: cp.conversations[0]!, messages: [], status: "success" as const, rawUniqueMessageCount: 0 };
      return cp;
    } };
    await expect(runExportFlow(collected, store, job, { async writeAndFinalize() { throw new Error("Excel 磁盘错误"); } })).rejects.toThrow("Excel 磁盘错误");
    expect(saved?.results.c1?.status).toBe("success");
  });

  it("Excel 写出期间取消不删除断点，保留文件并报告取消", async () => {
    const controller = new AbortController();
    let removed = false;
    let saves = 0;
    const store: JobStore = { async save() { saves++; }, async loadResumable() { return undefined; }, async remove() { removed = true; } };
    const job = { async start(cp: JobCheckpoint) {
      cp.results.c1 = { snapshot: cp.conversations[0]!, messages: [], status: "success" as const, rawUniqueMessageCount: 0 };
      return cp;
    } };
    let writing!: () => void;
    const entered = new Promise<void>(resolve => { writing = resolve; });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const result = runExportFlow(collected, store, job, { async writeAndFinalize() { writing(); await gate; return "saved-file.xlsx"; } }, undefined, controller.signal)
      .then(() => undefined, error => error);
    await entered;
    controller.abort(new Error("写出期间取消"));
    finish();
    expect((await result).message).toBe("写出期间取消");
    expect(removed).toBe(false);
    expect(saves).toBe(2);
  });

  it("开始前取消结束等待，已取消时也不等待开始", async () => {
    const controller = new AbortController();
    const start = new Promise<string>(() => {});
    const waiting = waitForStart(start, controller.signal);
    controller.abort(new Error("取消开始"));
    await expect(waiting).rejects.toThrow("取消开始");
    await expect(waitForStart(start, controller.signal)).rejects.toThrow("取消开始");
  });
});
