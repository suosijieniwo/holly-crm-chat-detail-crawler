import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

import type { JobCheckpoint } from "../../src/domain/types.js";
import { WorkbookWriter } from "../../src/export/workbook-writer.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function checkpoint(): JobCheckpoint {
  return {
    version: 1,
    jobId: "fictional-job",
    filter: {
      canonicalConditions: { Status: "finish" },
      sort: [],
      pageSize: 10,
      fingerprint: "fictional-fingerprint",
      capturedAt: "2026-08-26T09:00:00.000Z"
    },
    conversations: [
      {
        conversationId: "fictional-c1",
        ordinal: 1,
        summary: { visitorId: "访客甲", agent: "客服甲", startedAt: "2026-08-03 10:00:00" }
      }
    ],
    completedConversationIds: ["fictional-c1"],
    results: {
      "fictional-c1": {
        snapshot: {
          conversationId: "fictional-c1",
          ordinal: 1,
          summary: { visitorId: "访客甲", agent: "客服甲", startedAt: "2026-08-03 10:00:00" }
        },
        messages: [
          {
            messageId: "fictional-m1",
            sentAt: "2026-08-03 10:00:01",
            senderType: "visitor",
            senderName: "访客甲",
            messageType: "text",
            visibleText: "=不会被当成公式",
            contentIntegrity: "complete",
            source: "api",
            position: { pageOrCursor: "single", indexInBatch: 0 },
            localKey: "fictional-key",
            possibleDuplicate: false
          },
          {
            messageId: "fictional-m2",
            sentAt: "2026-08-03 10:00:02",
            senderType: "agent",
            senderName: "客服甲",
            messageType: "text",
            visibleText: "客服回复内容",
            contentIntegrity: "complete",
            source: "api",
            position: { pageOrCursor: "single", indexInBatch: 1 },
            localKey: "fictional-key-2",
            possibleDuplicate: false
          },
          {
            messageId: "fictional-m3",
            sentAt: "2026-08-03 10:00:03",
            senderType: "bot",
            senderName: "机器人",
            messageType: "text",
            visibleText: "机器人回复内容",
            contentIntegrity: "complete",
            source: "api",
            position: { pageOrCursor: "single", indexInBatch: 2 },
            localKey: "fictional-key-3",
            possibleDuplicate: false
          },
          {
            messageId: "fictional-m4",
            sentAt: "2026-08-03 10:00:04",
            senderType: "system",
            senderName: "系统",
            messageType: "system",
            visibleText: "系统通知",
            contentIntegrity: "complete",
            source: "api",
            position: { pageOrCursor: "single", indexInBatch: 3 },
            localKey: "fictional-key-4",
            possibleDuplicate: false
          },
          {
            messageId: "fictional-m5",
            sentAt: "2026-08-03 10:00:05",
            senderType: "visitor",
            senderName: "访客甲",
            messageType: "image",
            visibleText: "图片",
            contentIntegrity: "complete",
            mediaUrl: "https://example.com/customer-image.png",
            source: "api",
            position: { pageOrCursor: "single", indexInBatch: 4 },
            localKey: "fictional-key-5",
            possibleDuplicate: false
          }
        ],
        status: "success",
        rawUniqueMessageCount: 5
      }
    },
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:05:00.000Z"
  };
}

describe("WorkbookWriter", () => {
  it("人工长文本分行仍按一条消息计数并保留序号", async () => {
    const cp = checkpoint();
    cp.results["fictional-c1"]!.messages[1]!.visibleText = "长".repeat(64001);
    const dir = mkdtempSync(path.join(tmpdir(), "chat-export-long-"));
    dirs.push(dir);
    const output = await new WorkbookWriter(dir).writeAndFinalize(cp);
    const workbook = await new ExcelJS.Workbook().xlsx.readFile(output);
    const sheet = workbook.getWorksheet("消息明细")!;
    expect(workbook.getWorksheet("会话汇总")!.getCell("L2").value).toBe("3");
    expect(sheet.rowCount).toBe(6);
    expect([3, 4, 5].map(row => sheet.getCell(row, 2).value)).toEqual(["2", "2", "2"]);
    expect([3, 4, 5].map(row => sheet.getCell(row, 8).value).join("")).toBe("长".repeat(64001));
  });
  it("消息明细和消息总数保留访客与人工客服，排除机器人和系统", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "chat-export-workbook-"));
    dirs.push(dir);
    const writer = new WorkbookWriter(dir, () => new Date("2026-08-26T09:05:06.000Z"));
    const output = await writer.writeAndFinalize(checkpoint());

    const workbook = await new ExcelJS.Workbook().xlsx.readFile(output);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["会话汇总", "消息明细"]);
    const summary = workbook.getWorksheet("会话汇总")!;
    const detail = workbook.getWorksheet("消息明细")!;
    expect(summary.getCell("L1").value).toBe("消息总数");
    expect(summary.getCell("L2").value).toBe("3");
    expect(detail.rowCount).toBe(4);
    expect(
      Array.from({ length: 3 }, (_, index) => detail.getCell(index + 2, 5).value)
    ).toEqual(["visitor", "agent", "visitor"]);
    expect(
      Array.from({ length: 3 }, (_, index) => detail.getCell(index + 2, 8).value)
    ).toEqual(["=不会被当成公式", "客服回复内容", "图片"]);
    expect(detail.getCell("J4").value).toBe("https://example.com/customer-image.png");
    expect(detail.getCell("H2").value).toBe("=不会被当成公式");
    expect(detail.getCell("H2").type).not.toBe(ExcelJS.ValueType.Formula);
    expect(detail.getCell("H2").numFmt).toBe("@");
  });
});
