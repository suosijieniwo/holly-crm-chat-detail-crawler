import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkbookWriter } from "../dist/src/export/workbook-writer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleDir = path.join(root, "examples");
const target = path.join(exampleDir, "虚构客服聊天记录示例.xlsx");
await mkdir(exampleDir, { recursive: true });

const snapshot = {
  conversationId: "fictional-session-001",
  ordinal: 1,
  summary: {
    visitorId: "访客A",
    startedAt: "2026-08-03 10:00:00",
    endedAt: "2026-08-03 10:03:00",
    entry: "虚构入口",
    agent: "客服甲",
    skillGroup: "演示客服组",
    tags: ["虚构标签"],
    channel: "演示渠道",
    status: "已结束",
    satisfaction: "满意"
  }
};

const checkpoint = {
  version: 1,
  jobId: "fictional-example-job",
  filter: {
    canonicalConditions: { create_begin_time: "2026-08-03" },
    sort: [],
    pageSize: 10,
    fingerprint: "fictional-example-filter",
    capturedAt: "2026-08-26T09:00:00.000Z"
  },
  conversations: [snapshot],
  completedConversationIds: [snapshot.conversationId],
  results: {
    [snapshot.conversationId]: {
      snapshot,
      messages: [
        {
          messageId: "fictional-message-001",
          sentAt: "2026-08-03 10:00:01",
          senderType: "visitor",
          senderName: "访客A",
          messageType: "text",
          visibleText: "请问虚构商品如何查询？",
          contentIntegrity: "complete",
          source: "api",
          position: { pageOrCursor: "single", indexInBatch: 0 },
          localKey: "fictional-key-001",
          possibleDuplicate: false
        },
        {
          messageId: "fictional-message-002",
          sentAt: "2026-08-03 10:00:05",
          senderType: "agent",
          senderName: "客服甲",
          messageType: "text",
          visibleText: "您好，这是完全虚构的演示回复。",
          contentIntegrity: "complete",
          source: "api",
          position: { pageOrCursor: "single", indexInBatch: 1 },
          localKey: "fictional-key-002",
          possibleDuplicate: false
        }
      ],
      status: "success",
      rawUniqueMessageCount: 2
    }
  },
  createdAt: "2026-08-26T09:00:00.000Z",
  updatedAt: "2026-08-26T09:03:00.000Z"
};

const generated = await new WorkbookWriter(exampleDir, () => new Date("2026-08-26T09:03:00.000Z"))
  .writeAndFinalize(checkpoint);
await rm(target, { force: true });
await rename(generated, target);
console.log(target);
