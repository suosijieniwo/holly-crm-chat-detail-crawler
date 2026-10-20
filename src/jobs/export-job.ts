import {
  CHECKPOINT_EVERY_CONVERSATIONS,
  EXPORT_CONCURRENCY,
  MAX_CONSECUTIVE_FAILURES,
  MAX_CONSECUTIVE_PARTIALS,
  RETRY_DELAYS_MS
} from "../config/constants.js";
import type {
  Clock,
  ConversationResult,
  JobCheckpoint,
  MessageCollector
} from "../domain/types.js";
import { normalizeMessageCollection } from "../messages/normalize.js";
import type { JobStore } from "./checkpoint-store.js";
import { GlobalStartRateLimiter, systemClock } from "./rate-limiter.js";

export interface ExportProgress {
  total: number;
  completed: number;
  success: number;
  partial: number;
  failed: number;
  currentConversationId?: string;
}

export interface ExportJobOptions {
  concurrency?: number;
  checkpointEvery?: number;
  retryDelaysMs?: readonly number[];
  maxConsecutiveFailures?: number;
  maxConsecutivePartials?: number;
  clock?: Clock;
}

function isRetriable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/登录已失效|无权|401|403|白名单|禁止/.test(message)) return false;
  return /timeout|timed out|network|ECONN|ETIMEDOUT|HTTP 5\d\d/i.test(message);
}

function failedResult(snapshot: JobCheckpoint["conversations"][number], error: unknown): ConversationResult {
  const message = error instanceof Error ? error.message : "未知错误";
  const reason = /登录已失效|无权/.test(message) ? "登录已失效或无读取权限" : "消息采集失败";
  return {
    snapshot,
    messages: [],
    status: "failed",
    reason,
    rawUniqueMessageCount: 0
  };
}

export class ExportJob {
  private readonly concurrency: number;
  private readonly checkpointEvery: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly maxConsecutiveFailures: number;
  private readonly maxConsecutivePartials: number;
  private readonly clock: Clock;

  constructor(
    private readonly collector: MessageCollector,
    private readonly store: JobStore,
    private readonly limiter: GlobalStartRateLimiter,
    options: ExportJobOptions = {}
  ) {
    this.concurrency = options.concurrency ?? EXPORT_CONCURRENCY;
    this.checkpointEvery = options.checkpointEvery ?? CHECKPOINT_EVERY_CONVERSATIONS;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
    this.maxConsecutivePartials = options.maxConsecutivePartials ?? MAX_CONSECUTIVE_PARTIALS;
    this.clock = options.clock ?? systemClock;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("导出并发数无效");
  }

  async start(
    checkpoint: JobCheckpoint,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal
  ): Promise<JobCheckpoint> {
    const completed = new Set(checkpoint.completedConversationIds);
    checkpoint.completedConversationIds = [...completed];
    const pending = checkpoint.conversations.filter((item) => checkpoint.results[item.conversationId]?.status !== "success");
    const processed = new Set(checkpoint.conversations.filter(item => checkpoint.results[item.conversationId]?.status === "success").map(item => item.conversationId));
    let nextIndex = 0;
    let completedSinceSave = 0;
    let consecutiveFailures = 0;
    let consecutivePartials = 0;
    let haltedReason: Error | undefined;
    let saveTail: Promise<void> = Promise.resolve();

    const queueSave = async (): Promise<void> => {
      checkpoint.updatedAt = new Date(this.clock.now()).toISOString();
      const snapshot = structuredClone(checkpoint);
      saveTail = saveTail.catch(() => undefined).then(() => this.store.save(snapshot));
      await saveTail;
    };

    const progress = (currentConversationId?: string): void => {
      const values = Object.values(checkpoint.results);
      onProgress?.({
        total: checkpoint.conversations.length,
        completed: processed.size,
        success: values.filter((item) => item.status === "success").length,
        partial: values.filter((item) => item.status === "partial").length,
        failed: values.filter((item) => item.status === "failed").length,
        currentConversationId
      });
    };

    const collectWithRetry = async (
      snapshot: JobCheckpoint["conversations"][number]
    ): Promise<ConversationResult> => {
      for (let attempt = 0; ; attempt += 1) {
        signal?.throwIfAborted();
        await this.limiter.acquire(signal);
        try {
          return normalizeMessageCollection(snapshot, await this.collector.collect(snapshot, signal));
        } catch (error) {
          signal?.throwIfAborted();
          const delay = this.retryDelaysMs[attempt];
          if (delay === undefined || !isRetriable(error)) return failedResult(snapshot, error);
          await this.clock.sleep(delay, signal);
        }
      }
    };

    const worker = async (): Promise<void> => {
      while (!haltedReason) {
        signal?.throwIfAborted();
        const index = nextIndex;
        nextIndex += 1;
        const snapshot = pending[index];
        if (!snapshot) return;
        progress(snapshot.conversationId);
        const result = await collectWithRetry(snapshot);
        checkpoint.results[snapshot.conversationId] = result;
        processed.add(snapshot.conversationId);
        if (!completed.has(snapshot.conversationId)) {
          completed.add(snapshot.conversationId);
          checkpoint.completedConversationIds.push(snapshot.conversationId);
        }
        completedSinceSave += 1;

        if (result.status === "failed") {
          consecutiveFailures += 1;
          consecutivePartials = 0;
        } else if (result.status === "partial") {
          consecutivePartials += 1;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures = 0;
          consecutivePartials = 0;
        }

        if (consecutiveFailures >= this.maxConsecutiveFailures) {
          haltedReason = new Error("连续失败达到保护阈值，任务已暂停");
        } else if (consecutivePartials >= this.maxConsecutivePartials) {
          haltedReason = new Error("连续部分成功达到保护阈值，任务已暂停");
        }
        if (completedSinceSave >= this.checkpointEvery) {
          completedSinceSave = 0;
          await queueSave();
        }
        progress();
      }
    };

    await Promise.allSettled(Array.from({ length: Math.min(this.concurrency, pending.length || 1) }, async () => {
      try {
        await worker();
      } catch (error) {
        haltedReason ??= error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    }));
    try {
      await queueSave();
    } catch (saveError) {
      const failure = signal?.aborted ? signal.reason : haltedReason;
      if (signal?.aborted || haltedReason) {
        throw new AggregateError([failure, saveError], `${failure instanceof Error ? failure.message : String(failure)}；断点保存失败：${saveError instanceof Error ? saveError.message : String(saveError)}`);
      }
      throw saveError;
    }
    signal?.throwIfAborted();
    if (haltedReason) throw haltedReason;
    return checkpoint;
  }
}
