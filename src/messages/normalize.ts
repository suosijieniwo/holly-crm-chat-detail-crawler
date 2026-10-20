import { createHash } from "node:crypto";

import type {
  ConversationResult,
  ConversationSnapshot,
  MessageCollection,
  RawMessage
} from "../domain/types.js";

function proofKey(message: RawMessage): string | undefined {
  if (message.messageId) return `id:${message.messageId}`;
  if (message.serverSequence !== undefined) return `sequence:${message.serverSequence}`;
  return undefined;
}

function localKey(message: RawMessage, index: number): string {
  return (
    proofKey(message) ??
    `local:${createHash("sha256")
      .update(
        JSON.stringify([
          message.sentAt,
          message.senderType,
          message.visibleText,
          message.position.pageOrCursor,
          message.position.indexInBatch,
          index
        ])
      )
      .digest("hex")}`
  );
}

export function normalizeMessageCollection(
  snapshot: ConversationSnapshot,
  collection: MessageCollection
): ConversationResult {
  const seenProofs = new Set<string>();
  const retained: Array<RawMessage & { localKey: string; possibleDuplicate: boolean }> = [];
  const overlapIndexes = new Map<string, number[]>();

  collection.messages.forEach((message, index) => {
    const proof = proofKey(message);
    if (proof && seenProofs.has(proof)) return;
    if (proof) seenProofs.add(proof);

    const normalized = {
      ...message,
      localKey: localKey(message, index),
      possibleDuplicate: false
    };
    retained.push(normalized);
    if (message.stableOverlapKey) {
      const indexes = overlapIndexes.get(message.stableOverlapKey) ?? [];
      indexes.push(retained.length - 1);
      overlapIndexes.set(message.stableOverlapKey, indexes);
    }
  });

  for (const indexes of overlapIndexes.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) retained[index]!.possibleDuplicate = true;
  }

  const reasons: string[] = [];
  if (!collection.reachedHistoryStart) reasons.push("无法证明已到达历史起点");
  if (retained.some((message) => message.contentIntegrity === "incomplete")) {
    reasons.push("存在无法完整解析的消息内容");
  }
  const declared = collection.declaredMessageCount;
  if (declared?.comparable && declared.value !== retained.length) {
    reasons.push(`页面声明${declared.value}条，实际取得${retained.length}条`);
  }

  return {
    snapshot,
    messages: retained,
    status: reasons.length === 0 ? "success" : "partial",
    reason: reasons.length > 0 ? reasons.join("；") : undefined,
    declaredMessageCount: declared?.value,
    rawUniqueMessageCount: retained.length
  };
}
