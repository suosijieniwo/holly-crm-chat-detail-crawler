import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createObservedShape,
  shapeOnly,
  shouldObserve
} from "../../src/reconnaissance/capture-session.js";
import { SiteContractSchema, loadSiteContract } from "../../src/reconnaissance/contract-schema.js";

function validContract(): Record<string, unknown> {
  return {
    origin: "https://a8.7x24cc.com",
    page: {
      hash: "#/media/chat_record_advanced_query",
      requiredTexts: ["会话"],
      queryFormSelector: "[data-role=query-form]",
      resultTableSelector: "[data-role=result-table]"
    },
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
      pagination: {
        mode: "page",
        requestPagePath: "$.page",
        requestPageSizePath: "$.pageSize",
        responseHasNextPath: "$.hasNext"
      },
      requestFilterPaths: ["$.filters.status"],
      requestSortPath: "$.sort",
      responseRowsPath: "$.rows",
      responseTotalPath: "$.total",
      fields: {
        conversationId: "$.id",
        visitorId: "$.visitorId"
      }
    },
    messages: {
      operation: "message-detail",
      pagination: {
        mode: "single"
      },
      requestConversationIdPath: "$.conversationId",
      responseItemsPath: "$.items",
      responseDeclaredCountPath: "$.total",
      declaredCountComparable: true,
      fields: {
        messageId: "$.id",
        visibleText: "$.content"
      },
      supportsCompleteHistory: true
    },
    dom: {
      openConversationSelector: "[data-role=open-conversation]",
      messageRowSelector: "[data-role=message-row]",
      historyStartSelector: "[data-role=history-start]",
      scrollContainerSelector: "[data-role=message-scroll]",
      fields: {
        visibleText: "[data-role=message-text]"
      }
    }
  };
}

describe("SiteContractSchema", () => {
  it("接受字段完整的目标站点只读契约", () => {
    expect(SiteContractSchema.parse(validContract()).origin).toBe("https://a8.7x24cc.com");
  });

  it.each([
    ["未知 method", (value: Record<string, any>) => (value.operations[0].method = "PUT")],
    ["跨域 origin", (value: Record<string, any>) => (value.origin = "https://other.example")],
    ["空字段 path", (value: Record<string, any>) => (value.messages.fields.visibleText = "")],
    ["错误页面 hash", (value: Record<string, any>) => (value.page.hash = "#/media")],
    ["缺失动作名", (value: Record<string, any>) => delete value.operations[0].action],
    ["缺失历史起点选择器", (value: Record<string, any>) => delete value.dom.historyStartSelector]
  ])("拒绝%s", (_label, mutate) => {
    const value = validContract();
    mutate(value);
    expect(SiteContractSchema.safeParse(value).success).toBe(false);
  });
});

describe("loadSiteContract", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("加载失败仅报告配置字段名而不回显配置值", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "site-contract-test-"));
    tempDirs.push(dir);
    const file = path.join(dir, "site-contract.json");
    const invalid = validContract();
    (invalid.messages as Record<string, any>).fields.visibleText = "sensitive-sentinel";
    (invalid.messages as Record<string, any>).requestConversationIdPath = "";
    writeFileSync(file, JSON.stringify(invalid), "utf8");

    expect(() => loadSiteContract(file)).toThrow("messages.requestConversationIdPath");
    expect(() => loadSiteContract(file)).not.toThrow("sensitive-sentinel");
  });
});

describe("勘测形状脱敏", () => {
  it("仅提取 JSON 键路径并以首个数组元素代表数组结构", () => {
    expect(
      shapeOnly({ rows: [{ id: "conversation-secret", nested: { text: "chat-secret" } }] })
    ).toEqual(["$.rows[].id", "$.rows[].nested.text"]);
  });

  it("报告不包含 query、请求值、响应值或 header", () => {
    const observed = createObservedShape({
      method: "POST",
      url: "https://a8.7x24cc.com/api/read/list?visitor=visitor-secret",
      status: 200,
      contentType: "application/json",
      requestJson: { filters: { visitor: "visitor-secret" }, page: 1 },
      responseJson: { rows: [{ id: "conversation-secret", text: "chat-secret" }], total: 1 }
    });

    expect(observed).toEqual({
      method: "POST",
      origin: "https://a8.7x24cc.com",
      pathname: "/api/read/list",
      status: 200,
      contentType: "application/json",
      requestKeyPaths: ["$.filters.visitor", "$.page"],
      responseKeyPaths: ["$.rows[].id", "$.rows[].text", "$.total"],
      arrayLengths: { "$.rows": 1 }
    });
    expect(JSON.stringify(observed)).not.toContain("visitor-secret");
    expect(JSON.stringify(observed)).not.toContain("conversation-secret");
    expect(JSON.stringify(observed)).not.toContain("chat-secret");
  });

  it("只观察目标同源的 GET/POST XHR 或 fetch", () => {
    expect(
      shouldObserve({
        method: "POST",
        url: "https://a8.7x24cc.com/api/read/list",
        resourceType: "xhr"
      })
    ).toBe(true);
    expect(
      shouldObserve({
        method: "GET",
        url: "https://a8.7x24cc.com/css/app.css",
        resourceType: "stylesheet"
      })
    ).toBe(false);
    expect(
      shouldObserve({
        method: "DELETE",
        url: "https://a8.7x24cc.com/api/read/list",
        resourceType: "fetch"
      })
    ).toBe(false);
    expect(
      shouldObserve({
        method: "GET",
        url: "https://other.example/api/read/list",
        resourceType: "xhr"
      })
    ).toBe(false);
  });
});
