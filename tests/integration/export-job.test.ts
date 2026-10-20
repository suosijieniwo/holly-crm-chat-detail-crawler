import { describe, expect, it } from "vitest";

import type {
  Clock,
  JobCheckpoint,
  MessageCollection,
  MessageCollector
} from "../../src/domain/types.js";
import { ExportJob } from "../../src/jobs/export-job.js";
import type { JobStore } from "../../src/jobs/checkpoint-store.js";
import { GlobalStartRateLimiter } from "../../src/jobs/rate-limiter.js";

const clock: Clock = {
  now: () => 0,
  sleep: async () => undefined
};

function checkpoint(): JobCheckpoint {
  return {
    version: 1,
    jobId: "fictional-job",
    filter: {
      canonicalConditions: { Status: "finish" },
      sort: [],
      pageSize: 10,
      fingerprint: "fp",
      capturedAt: "2026-08-26T09:00:00.000Z"
    },
    conversations: [
      { conversationId: "c1", ordinal: 1, summary: {} },
      { conversationId: "c2", ordinal: 2, summary: {} },
      { conversationId: "c3", ordinal: 3, summary: {} }
    ],
    completedConversationIds: [],
    results: {},
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z"
  };
}

describe("ExportJob", () => {
  it("最终保存失败同时保留原始工作线程错误，并等待在途线程", async () => {
    const cp = checkpoint();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const collecting = new Promise<void>(resolve => { entered = resolve; });
    let finished = false;
    const collector: MessageCollector = { async collect() {
      entered();
      await gate;
      finished = true;
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    const store: JobStore = { async save() { throw new Error("save failure"); }, async loadResumable() { return undefined; }, async remove() {} };
    const result = new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { concurrency: 2, clock }).start(cp, value => {
      if (value.currentConversationId === "c2") throw new Error("original worker failure");
    }).then(() => undefined, error => error);
    await collecting;
    release();
    const error = await result;
    expect(finished).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toContain("original worker failure");
    expect(error.message).toContain("save failure");
  });
  it("两个worker完成固定快照并保存断点", async () => {
    const calls: string[] = [];
    const collector: MessageCollector = {
      async collect(conversation): Promise<MessageCollection> {
        calls.push(conversation.conversationId);
        return {
          messages: [
            {
              messageId: `m-${conversation.conversationId}`,
              senderType: "visitor",
              messageType: "text",
              visibleText: "虚构消息",
              contentIntegrity: "complete",
              source: "api",
              position: { pageOrCursor: "single", indexInBatch: 0 }
            }
          ],
          reachedHistoryStart: true,
          stopReason: "explicit-end",
          source: "api"
        };
      }
    };
    let saves = 0;
    const store: JobStore = {
      async save() {
        saves += 1;
      },
      async loadResumable() {
        return undefined;
      },
      async remove() {}
    };
    const result = await new ExportJob(
      collector,
      store,
      new GlobalStartRateLimiter(0, clock),
      { concurrency: 2, checkpointEvery: 2, clock }
    ).start(checkpoint());

    expect(new Set(calls)).toEqual(new Set(["c1", "c2", "c3"]));
    expect(result.completedConversationIds).toHaveLength(3);
    expect(Object.values(result.results).every((item) => item.status === "success")).toBe(true);
    expect(saves).toBeGreaterThanOrEqual(2);
  });

  it("恢复时跳过已经完成的会话", async () => {
    const cp = checkpoint();
    cp.completedConversationIds = ["c1"];
    cp.results.c1 = { snapshot: cp.conversations[0]!, messages: [], status: "success", rawUniqueMessageCount: 0 };
    const calls: string[] = [];
    const collector: MessageCollector = {
      async collect(conversation) {
        calls.push(conversation.conversationId);
        return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
      }
    };
    const store: JobStore = {
      async save() {},
      async loadResumable() {
        return undefined;
      },
      async remove() {}
    };
    await new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), {
      concurrency: 2,
      clock
    }).start(cp);
    expect(calls).toEqual(["c2", "c3"]);
  });

  it("旧失败和部分成功会话续跑，成功跳过且完成 ID 不重复", async () => {
    const cp = checkpoint();
    cp.completedConversationIds = ["c1", "c2", "c2", "c3"];
    for (const [i, status] of (["success", "failed", "partial"] as const).entries()) {
      const snapshot = cp.conversations[i]!;
      cp.results[snapshot.conversationId] = { snapshot, messages: [], status, rawUniqueMessageCount: 0 };
    }
    const calls: string[] = [];
    const collector: MessageCollector = { async collect(snapshot) {
      calls.push(snapshot.conversationId);
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    const store: JobStore = { async save() {}, async loadResumable() { return undefined; }, async remove() {} };
    const progress: number[] = [];
    await new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { clock }).start(cp, value => progress.push(value.completed));
    expect(progress[0]).toBe(1);
    expect(calls).toEqual(["c2", "c3"]);
    expect(cp.completedConversationIds).toEqual(["c1", "c2", "c3"]);
    expect(Object.values(cp.results).every(result => result.status === "success")).toBe(true);
  });

  it.each(["failed", "partial"] as const)("%s 达到保护阈值立即停止领取，等待在途请求与最终保存", async status => {
    const cp = checkpoint();
    const calls: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let saving!: () => void;
    const firstSave = new Promise<void>(resolve => { saving = resolve; });
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const collector: MessageCollector = { async collect(snapshot) {
      calls.push(snapshot.conversationId);
      if (snapshot.conversationId === "c1") {
        if (status === "failed") throw new Error("无权读取");
        return { messages: [], reachedHistoryStart: false, stopReason: "unknown", source: "api" };
      }
      await pending;
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    let saves = 0;
    let final: JobCheckpoint | undefined;
    const store: JobStore = { async save(value) {
      if (++saves === 1) { saving(); await saveGate; }
      final = structuredClone(value);
    }, async loadResumable() { return undefined; }, async remove() {} };
    const result = new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { concurrency: 2, checkpointEvery: 1, maxConsecutiveFailures: 1, maxConsecutivePartials: 1, clock })
      .start(cp).then(() => undefined, error => error);
    await firstSave;
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    releaseSave();
    expect((await result).message).toContain("保护阈值");
    expect(calls).toEqual(["c1", "c2"]);
    expect(final).toEqual(cp);
  });

  it("取消等待所有在途线程并最终保存，不写入取消失败", async () => {
    const cp = checkpoint();
    const controller = new AbortController();
    let entered = 0;
    let ready!: () => void;
    const bothStarted = new Promise<void>(resolve => { ready = resolve; });
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const collector: MessageCollector = { async collect(snapshot, signal) {
      entered++;
      if (entered === 2) ready();
      if (snapshot.conversationId === "c1") {
        await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
        signal!.throwIfAborted();
      }
      await delayed;
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    const saved: JobCheckpoint[] = [];
    const store: JobStore = { async save(value) { saved.push(structuredClone(value)); }, async loadResumable() { return undefined; }, async remove() {} };
    let settled = false;
    const run = new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { concurrency: 2, clock })
      .start(cp, undefined, controller.signal).then(() => undefined, error => error).finally(() => { settled = true; });
    await bothStarted;
    controller.abort(new Error("用户取消"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect((await run).message).toBe("用户取消");
    expect(cp.results.c1).toBeUndefined();
    expect(entered).toBe(2);
    expect(saved.at(-1)).toEqual(cp);
    const final = structuredClone(cp);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cp).toEqual(final);
  });

  it("排队保存使用独立快照且保存失败会停止领取新会话", async () => {
    const cp = checkpoint();
    const captures: JobCheckpoint[] = [];
    const collector: MessageCollector = { async collect() {
      return { messages: [], reachedHistoryStart: true, stopReason: "explicit-end", source: "api" };
    } };
    const store: JobStore = { async save(value) { captures.push(value); }, async loadResumable() { return undefined; }, async remove() {} };
    await new ExportJob(collector, store, new GlobalStartRateLimiter(0, clock), { concurrency: 1, checkpointEvery: 1, clock }).start(cp);
    expect(captures[0]!.completedConversationIds).toEqual(["c1"]);
    expect(captures[0]).not.toBe(cp);
    const failed = checkpoint();
    const broken: JobStore = { ...store, async save() { throw new Error("磁盘写入失败"); } };
    await expect(new ExportJob(collector, broken, new GlobalStartRateLimiter(0, clock), { concurrency: 1, checkpointEvery: 1, clock }).start(failed)).rejects.toThrow("磁盘写入失败");
    expect(failed.completedConversationIds).toEqual(["c1"]);
  });
});
