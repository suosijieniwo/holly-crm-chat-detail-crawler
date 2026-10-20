import { randomUUID } from "node:crypto";

import type { JobCheckpoint } from "../domain/types.js";
import type { WorkbookWriter } from "../export/workbook-writer.js";
import type { ListCollectionResult } from "../query/list-collector.js";
import type { JobStore } from "./checkpoint-store.js";
import type { ExportJob, ExportProgress } from "./export-job.js";

export async function waitForStart<T>(start: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([start, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function runExportFlow(
  collected: Pick<ListCollectionResult, "filter" | "conversations">,
  store: JobStore,
  job: Pick<ExportJob, "start">,
  writer: Pick<WorkbookWriter, "writeAndFinalize">,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal
): Promise<{ checkpoint: JobCheckpoint; output: string; complete: boolean }> {
  signal?.throwIfAborted();
  const now = new Date().toISOString();
  const checkpoint: JobCheckpoint = await store.loadResumable(collected.filter.fingerprint) ?? {
    version: 1,
    senderMappingVersion: 2,
    jobId: randomUUID(),
    filter: collected.filter,
    conversations: collected.conversations,
    completedConversationIds: [],
    results: {},
    createdAt: now,
    updatedAt: now
  };
  if (checkpoint.senderMappingVersion !== 2) {
    for (const result of Object.values(checkpoint.results)) {
      if (result.status === "success") {
        result.status = "partial";
        result.reason = "旧版本发送方分类可能遗漏人工消息，需要重新采集";
      }
    }
    checkpoint.senderMappingVersion = 2;
  }
  await store.save(checkpoint);
  try {
    await job.start(checkpoint, onProgress, signal);
    signal?.throwIfAborted();
    const output = await writer.writeAndFinalize(checkpoint);
    signal?.throwIfAborted();
    const complete = checkpoint.conversations.every(item => checkpoint.results[item.conversationId]?.status === "success");
    if (complete) await store.remove(checkpoint.jobId);
    else await store.save(checkpoint);
    return { checkpoint, output, complete };
  } catch (error) {
    try {
      await store.save(checkpoint);
    } catch (saveError) {
      throw new AggregateError([error, saveError], `${error instanceof Error ? error.message : String(error)}；断点保存失败：${saveError instanceof Error ? saveError.message : String(saveError)}`);
    }
    throw error;
  }
}
