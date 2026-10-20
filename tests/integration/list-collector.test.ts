import { describe, expect, it } from "vitest";

import type { ActionExecutor, ActionRequestTemplate } from "../../src/browser/action-request.js";
import type { SiteContract } from "../../src/domain/types.js";
import { ListCollector } from "../../src/query/list-collector.js";

const contract = {
  origin: "https://a8.7x24cc.com",
  operations: [
    {
      operation: "conversation-list",
      method: "POST",
      pathnamePattern: "^/action$",
      action: "app.media.queryChatRecord"
    },
    {
      operation: "message-detail",
      method: "POST",
      pathnamePattern: "^/action$",
      action: "app.media.getSessionRecord"
    }
  ],
  list: {
    operation: "conversation-list",
    pagination: { mode: "page", requestPagePath: "$.data.page", requestPageSizePath: "$.data.limit" },
    requestFilterPaths: ["$.data.Status"],
    responseRowsPath: "$.list",
    responseTotalPath: "$.count",
    fields: {
      conversationId: "$.SequenceId",
      visitorId: "$.VisitorId",
      startedAt: "$.BeginTime",
      agent: "$.AgentName"
    }
  }
} as unknown as SiteContract;

const template: ActionRequestTemplate = {
  method: "POST",
  url: "https://a8.7x24cc.com/action",
  action: "app.media.queryChatRecord",
  data: { Status: "finish", page: 2, limit: 2 },
  envelope: {
    action: "app.media.queryChatRecord",
    data: "{}",
    sessionId: "session-placeholder",
    action_id: "0.1",
    newCurrentMenuId: "#/media/chat_record_advanced_query"
  }
};

describe("ListCollector", () => {
  it("固定筛选并遍历全部页，按会话ID去重", async () => {
    const calls: number[] = [];
    const executor: ActionExecutor = {
      async execute(_operation, _template, _action, data) {
        const page = Number((data as Record<string, unknown>).page);
        calls.push(page);
        const pages: Record<number, unknown[]> = {
          1: [
            { SequenceId: "c1", VisitorId: "v1", BeginTime: "2026-08-03 10:00:00", AgentName: "客服甲" },
            { SequenceId: "c2", VisitorId: "v2", BeginTime: "2026-08-03 11:00:00", AgentName: "客服乙" }
          ],
          2: [
            { SequenceId: "c2", VisitorId: "v2", BeginTime: "2026-08-03 11:00:00", AgentName: "客服乙" },
            { SequenceId: "c3", VisitorId: "v3", BeginTime: "2026-08-03 12:00:00", AgentName: "客服甲" }
          ]
        };
        return { success: true, list: pages[page] ?? [], count: 4 };
      }
    };

    const result = await new ListCollector(contract, executor).collect(template, "2026-08-26T09:00:00.000Z");

    expect(calls).toEqual([1, 2, 3]);
    expect(result.reportedTotal).toBe(4);
    expect(result.conversations.map((item) => item.conversationId)).toEqual(["c1", "c2", "c3"]);
    expect(result.conversations[0]?.summary.agent).toBe("客服甲");
    expect(result.filter.canonicalConditions).toEqual({ Status: "finish" });
  });

  it("筛选参数已冻结时允许实时总量变化，并继续读取至空页", async () => {
    const calls: number[] = [];
    const executor: ActionExecutor = {
      async execute(_operation, _template, _action, data) {
        const page = Number((data as Record<string, unknown>).page);
        calls.push(page);
        if (page > 2) return { success: true, list: [], count: 5 };
        return {
          success: true,
          list: [
            { SequenceId: `c${page * 2 - 1}` },
            { SequenceId: `c${page * 2}` }
          ],
          count: page === 1 ? 4 : 5
        };
      }
    };

    const result = await new ListCollector(contract, executor).collect(template);

    expect(calls).toEqual([1, 2, 3]);
    expect(result.reportedTotal).toBe(4);
    expect(result.conversations.map((item) => item.conversationId)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("接口总数停在90但后续页仍有数据时继续导出到空页", async () => {
    const calls: number[] = [];
    const cappedTemplate: ActionRequestTemplate = {
      ...template,
      data: { Status: "finish", page: 1, limit: 30 }
    };
    const executor: ActionExecutor = {
      async execute(_operation, _template, _action, data) {
        const page = Number((data as Record<string, unknown>).page);
        calls.push(page);
        if (page > 4) return { success: true, list: [], count: 90 };
        return {
          success: true,
          list: Array.from({ length: 30 }, (_, index) => ({
            SequenceId: `c${(page - 1) * 30 + index + 1}`
          })),
          count: 90
        };
      }
    };

    const result = await new ListCollector(contract, executor).collect(cappedTemplate);

    expect(calls).toEqual([1, 2, 3, 4, 5]);
    expect(result.reportedTotal).toBe(90);
    expect(result.conversations).toHaveLength(120);
  });
});
