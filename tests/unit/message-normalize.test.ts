import { describe, expect, it } from "vitest";

import type { ConversationSnapshot, MessageCollection, RawMessage } from "../../src/domain/types.js";
import { normalizeMessageCollection } from "../../src/messages/normalize.js";

const snapshot: ConversationSnapshot = { conversationId: "c1", ordinal: 1, summary: {} };

function message(overrides: Partial<RawMessage>): RawMessage {
  return {
    senderType: "visitor",
    messageType: "text",
    visibleText: "虚构消息",
    contentIntegrity: "complete",
    source: "api",
    position: { pageOrCursor: "single", indexInBatch: 0 },
    ...overrides
  };
}

describe("normalizeMessageCollection", () => {
  it("按消息ID去重并保留首次出现顺序", () => {
    const collection: MessageCollection = {
      messages: [
        message({ messageId: "m1", position: { pageOrCursor: "single", indexInBatch: 0 } }),
        message({ messageId: "m1", position: { pageOrCursor: "single", indexInBatch: 1 } }),
        message({ messageId: "m2", position: { pageOrCursor: "single", indexInBatch: 2 } })
      ],
      reachedHistoryStart: true,
      stopReason: "explicit-end",
      source: "api"
    };
    const result = normalizeMessageCollection(snapshot, collection);
    expect(result.messages.map((item) => item.messageId)).toEqual(["m1", "m2"]);
    expect(result.rawUniqueMessageCount).toBe(2);
    expect(result.status).toBe("success");
  });

  it("无法证明相同的相似消息均保留并标记可能重复", () => {
    const collection: MessageCollection = {
      messages: [
        message({ stableOverlapKey: "same", position: { pageOrCursor: "single", indexInBatch: 0 } }),
        message({ stableOverlapKey: "same", position: { pageOrCursor: "single", indexInBatch: 1 } })
      ],
      reachedHistoryStart: true,
      stopReason: "explicit-end",
      source: "api"
    };
    const result = normalizeMessageCollection(snapshot, collection);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((item) => item.possibleDuplicate)).toBe(true);
  });

  it("历史不完整或正文缺失时标记部分成功", () => {
    const result = normalizeMessageCollection(snapshot, {
      messages: [message({ contentIntegrity: "incomplete" })],
      reachedHistoryStart: false,
      stopReason: "unknown",
      source: "api"
    });
    expect(result.status).toBe("partial");
  });
});
