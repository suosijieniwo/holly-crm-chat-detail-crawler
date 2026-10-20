import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PlaywrightActionExecutor,
  parseActionRequest,
  type ActionPage
} from "../../src/browser/action-request.js";
import { ReadonlyRequestPolicy } from "../../src/security/request-policy.js";

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
  ]
} as const;

describe("parseActionRequest", () => {
  it("解析站点的 form-urlencoded 动作请求", () => {
    const body = new URLSearchParams({
      action: "app.media.queryChatRecord",
      data: JSON.stringify({ Status: "finish", page: 1, limit: 10 }),
      sessionId: "session-placeholder",
      action_id: "0.1",
      newCurrentMenuId: "#/media/chat_record_advanced_query"
    }).toString();

    const parsed = parseActionRequest("https://a8.7x24cc.com/action", body);
    expect(parsed.action).toBe("app.media.queryChatRecord");
    expect(parsed.data).toEqual({ Status: "finish", page: 1, limit: 10 });
  });
});

describe("PlaywrightActionExecutor", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["fetch", "body"])("挂起的%s在30秒后超时，避免取消无限等待", async phase => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, options: RequestInit) => {
      const pending = () => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
      return phase === "fetch" ? pending() : Promise.resolve({ status: 200, ok: true, json: pending });
    });
    const page: ActionPage = { evaluate: async (fn, arg) => fn(arg) };
    const executor = new PlaywrightActionExecutor(page, new ReadonlyRequestPolicy(contract));
    const template = parseActionRequest("https://a8.7x24cc.com/action", "action=app.media.queryChatRecord&data=%7B%7D");
    const result = executor.execute("conversation-list", template, template.action, {}).then(() => "unexpected", error => error);
    await vi.advanceTimersByTimeAsync(30000);
    expect((await result).name).toBe("TimeoutError");
  });
  it("只替换动作、数据和随机动作ID后在登录页面内执行", async () => {
    let argument: unknown;
    const page: ActionPage = {
      async evaluate(_fn, arg) {
        argument = arg;
        return { status: 200, ok: true, body: { success: true, list: [] } };
      }
    };
    const executor = new PlaywrightActionExecutor(page, new ReadonlyRequestPolicy(contract));
    const template = parseActionRequest(
      "https://a8.7x24cc.com/action",
      new URLSearchParams({
        action: "app.media.queryChatRecord",
        data: JSON.stringify({ page: 1, limit: 10 }),
        sessionId: "session-placeholder",
        action_id: "old",
        newCurrentMenuId: "#/media/chat_record_advanced_query"
      }).toString()
    );

    await executor.execute(
      "message-detail",
      template,
      "app.media.getSessionRecord",
      { SequenceID: "fictional-conversation", pageSize: 0 }
    );

    const sent = argument as { envelope: Record<string, string> };
    expect(sent.envelope.action).toBe("app.media.getSessionRecord");
    expect(JSON.parse(sent.envelope.data)).toEqual({
      SequenceID: "fictional-conversation",
      pageSize: 0
    });
    expect(sent.envelope.action_id).not.toBe("old");
  });

  it("动作变化时拒绝复用动作绑定令牌", async () => {
    const page: ActionPage = {
      async evaluate() {
        throw new Error("不应执行");
      }
    };
    const executor = new PlaywrightActionExecutor(page, new ReadonlyRequestPolicy(contract));
    const template = parseActionRequest(
      "https://a8.7x24cc.com/action",
      new URLSearchParams({
        action: "app.media.queryChatRecord",
        data: "{}",
        token: "action-bound-placeholder"
      }).toString()
    );

    await expect(
      executor.execute("message-detail", template, "app.media.getSessionRecord", { SequenceID: "c1" })
    ).rejects.toThrow("动作绑定令牌");
  });
});
