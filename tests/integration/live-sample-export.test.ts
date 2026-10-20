import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { expect, it } from "vitest";

import type { JobCheckpoint, SiteContract } from "../../src/domain/types.js";
import { WorkbookWriter } from "../../src/export/workbook-writer.js";
import { ApiMessageCollector } from "../../src/messages/api-collector.js";
import { normalizeMessageCollection } from "../../src/messages/normalize.js";

it("真实40条脱敏响应贯穿采集、标准化和Excel，保留28条人工/访客及3条图片链接", async () => {
  const response = JSON.parse(await readFile(new URL("../fixtures/live-session-redacted.json", import.meta.url), "utf8"));
  const contract: SiteContract = JSON.parse(await readFile(new URL("../../config/site-contract.local.json", import.meta.url), "utf8"));
  const snapshot = { conversationId: "redacted-session", ordinal: 1, summary: {} };
  const collection = await new ApiMessageCollector(contract, { async execute() { return response; } }, {
    method: "POST", url: `${contract.origin}/action`, action: "app.media.queryChatRecord", data: {}, envelope: {}
  }).collect(snapshot);
  const result = normalizeMessageCollection(snapshot, collection);
  expect(result.messages).toHaveLength(40);
  expect(result.status).toBe("success");
  const cp: JobCheckpoint = {
    version: 1, senderMappingVersion: 2, jobId: "redacted-job",
    filter: { canonicalConditions: {}, sort: [], pageSize: 10, fingerprint: "redacted", capturedAt: "2026-10-11" },
    conversations: [snapshot], completedConversationIds: [snapshot.conversationId],
    results: { [snapshot.conversationId]: result }, createdAt: "2026-10-11", updatedAt: "2026-10-11"
  };
  const dir = await mkdtemp(path.join(tmpdir(), "chat-export-live-redacted-"));
  try {
    const output = await new WorkbookWriter(dir).writeAndFinalize(cp);
    const workbook = await new ExcelJS.Workbook().xlsx.readFile(output);
    const detail = workbook.getWorksheet("消息明细")!;
    expect(workbook.getWorksheet("会话汇总")!.getCell("L2").value).toBe("28");
    expect(detail.rowCount).toBe(29);
    const roles = Array.from({ length: 28 }, (_, index) => detail.getCell(index + 2, 5).value);
    expect(roles.filter(role => role === "visitor")).toHaveLength(16);
    expect(roles.filter(role => role === "agent")).toHaveLength(12);
    expect(Array.from({ length: 28 }, (_, index) => detail.getCell(index + 2, 10).value).filter(Boolean)).toHaveLength(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
