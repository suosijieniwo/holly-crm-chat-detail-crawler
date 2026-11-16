import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { Clock, JobCheckpoint, MessageCollector } from "../../src/domain/types.js";
import { WorkbookWriter } from "../../src/export/workbook-writer.js";
import type { JobStore } from "../../src/jobs/checkpoint-store.js";
import { runExportFlow, waitForStart } from "../../src/jobs/export-flow.js";
import { ExportJob } from "../../src/jobs/export-job.js";
import { GlobalStartRateLimiter } from "../../src/jobs/rate-limiter.js";
import { normalizeMessageCollection } from "../../src/messages/normalize.js";

const collected = {
  filter: { canonicalConditions: {}, sort: [], pageSize: 10, fingerprint: "fp", capturedAt: "2026-10-11" },
  conversations: [{ conversationId: "c1", ordinal: 1, summary: {} }]
};

describe("export flow", () => {
  it("同一筛选恢复旧1751条任务时纳入本轮5157条会话", async () => {
    const freshFilter = { ...collected.filter, capturedAt: "2026-11-12T03:00:00.000Z" };
    const conversations = Array.from({ length: 5157 }, (_, index) => ({ conversationId: `c${index + 1}`, ordinal: index + 1, summary: {} }));
    const cp: JobCheckpoint = {
      version: 1, senderMappingVersion: 2, jobId: "growing-query", filter: { ...collected.filter, capturedAt: "2026-11-11T07:23:32.015Z" },
      conversations: conversations.slice(0, 1751), completedConversationIds: conversations.slice(0, 1751).map(item => item.conversationId), results: {},
      createdAt: "2026-11-11T07:23:54.504Z", updatedAt: "2026-11-11T07:23:54.504Z"
    };
    cp.conversations.forEach((snapshot, index) => {
      cp.results[snapshot.conversationId] = { snapshot, messages: [], status: index < 1720 ? "success" : "partial", rawUniqueMessageCount: 0 };
    });
    const calls: string[] = [];
    const collector: MessageCollector = { async collect(snapshot) {
      calls.push(snapshot.conversationId);
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    const store: JobStore = { async save() {}, async loadResumable() { return cp; }, async remove() {} };
    const clock: Clock = { now: () => 0, sleep: async () => undefined };
    const job = new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { clock, checkpointEvery: 10000 });
    let exported: JobCheckpoint | undefined;
    const result = await runExportFlow({ filter: freshFilter, conversations }, store, job, {
      async writeAndFinalize(value) { exported = structuredClone(value); return "expanded.xlsx"; }
    });
    expect(exported!.conversations).toHaveLength(5157);
    expect(calls).toHaveLength(3437);
    expect(new Set(calls).size).toBe(3437);
    expect(calls).not.toContain("c1");
    expect(calls).toContain("c1721");
    expect(calls).toContain("c5157");
    expect(Object.values(exported!.results).filter(item => item.status === "success")).toHaveLength(5157);
    expect(result.checkpoint.filter.capturedAt).toBe("2026-11-12T03:00:00.000Z");
    expect(result.checkpoint.jobId).toBe("growing-query");
    expect(result.checkpoint.createdAt).toBe("2026-11-11T07:23:54.504Z");
  });

  it("恢复结果只保留当前名单，并使用本轮顺序和汇总字段", async () => {
    const oldSnapshot = { conversationId: "keep", ordinal: 1, summary: { agent: "旧客服" } };
    const removedSnapshot = { conversationId: "removed", ordinal: 2, summary: {} };
    const freshSnapshot = { conversationId: "keep", ordinal: 2, summary: { agent: "当前客服" } };
    const conversations = [{ conversationId: "new", ordinal: 1, summary: {} }, freshSnapshot];
    const cached: JobCheckpoint = {
      version: 1, senderMappingVersion: 2, jobId: "changed-query", filter: collected.filter,
      conversations: [oldSnapshot, removedSnapshot], completedConversationIds: ["keep", "removed", "keep", "unknown"],
      results: {
        keep: { snapshot: oldSnapshot, messages: [], status: "success", rawUniqueMessageCount: 0 },
        removed: { snapshot: removedSnapshot, messages: [], status: "success", rawUniqueMessageCount: 0 }
      }, createdAt: "2026-11-11", updatedAt: "2026-11-11"
    };
    const store: JobStore = { async save() {}, async loadResumable() { return cached; }, async remove() {} };
    const job = { async start(cp: JobCheckpoint) {
      expect(cp.conversations).toEqual(conversations);
      expect(Object.keys(cp.results)).toEqual(["keep"]);
      expect(cp.completedConversationIds).toEqual(["keep"]);
      expect(cp.results.keep!.snapshot).toEqual(freshSnapshot);
      return cp;
    } };
    const result = await runExportFlow({ ...collected, conversations }, store, job, { async writeAndFinalize() { return "current.xlsx"; } });
    expect(result.complete).toBe(false);
  });

  it("恢复后连续内容解析不完整仍生成 Excel，保留部分成功与重试断点", async () => {
    const conversations = Array.from({ length: 13 }, (_, index) => ({ conversationId: `c${index + 1}`, ordinal: index + 1, summary: {} }));
    const cp: JobCheckpoint = {
      version: 1, senderMappingVersion: 2, jobId: "content-partials", filter: collected.filter,
      conversations, completedConversationIds: conversations.map(item => item.conversationId), results: {},
      createdAt: "2026-11-11", updatedAt: "2026-11-11"
    };
    const calls: string[] = [];
    const collector: MessageCollector = { async collect(snapshot) {
      calls.push(snapshot.conversationId);
      return {
        messages: [{ messageId: `m-${snapshot.conversationId}`, senderType: "visitor", messageType: "file", visibleText: "附件", contentIntegrity: "incomplete", source: "api", position: { pageOrCursor: "single", indexInBatch: 0 } }],
        reachedHistoryStart: true, stopReason: "explicit-end", source: "api"
      };
    } };
    cp.results.c1 = { snapshot: conversations[0]!, messages: [], status: "success", rawUniqueMessageCount: 0 };
    for (const snapshot of conversations.slice(1)) {
      cp.results[snapshot.conversationId] = normalizeMessageCollection(snapshot, await collector.collect(snapshot));
    }
    calls.length = 0;
    let saved: JobCheckpoint | undefined;
    let removed = false;
    const store: JobStore = { async save(value) { saved = structuredClone(value); }, async loadResumable() { return cp; }, async remove() { removed = true; } };
    const clock: Clock = { now: () => 0, sleep: async () => undefined };
    const job = new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { concurrency: 1, clock });
    const dir = mkdtempSync(path.join(tmpdir(), "chat-export-content-partials-"));
    try {
      const result = await runExportFlow({ ...collected, conversations }, store, job, new WorkbookWriter(dir));
      expect(calls).toEqual(conversations.slice(1).map(item => item.conversationId));
      expect(result.complete).toBe(false);
      expect(removed).toBe(false);
      expect(Object.values(saved!.results).filter(item => item.status === "partial")).toHaveLength(12);
      expect(saved!.results.c2!.reason).toBe("存在无法完整解析的消息内容");
      const workbook = await new ExcelJS.Workbook().xlsx.readFile(result.output);
      const summary = workbook.getWorksheet("会话汇总")!;
      const detail = workbook.getWorksheet("消息明细")!;
      expect(summary.rowCount).toBe(14);
      expect(summary.getCell("N2").value).toBe("成功");
      expect(summary.getCell("N14").value).toBe("部分成功");
      expect(detail.rowCount).toBe(13);
      expect(detail.getCell("I13").value).toBe("incomplete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
