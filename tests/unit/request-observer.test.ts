import { describe, expect, it } from "vitest";

import {
  ListQueryObserver,
  type ResponseEventSource,
  type ResponseLike
} from "../../src/browser/request-observer.js";
import { PlaywrightActionExecutor } from "../../src/browser/action-request.js";
import { ReadonlyRequestPolicy } from "../../src/security/request-policy.js";

class FakeSource implements ResponseEventSource {
  private handlers = new Set<(response: ResponseLike) => void>();

  on(_event: "response", handler: (response: ResponseLike) => void): void {
    this.handlers.add(handler);
  }

  off(_event: "response", handler: (response: ResponseLike) => void): void {
    this.handlers.delete(handler);
  }

  emit(response: ResponseLike): void {
    for (const handler of this.handlers) handler(response);
  }
}

describe("ListQueryObserver", () => {
  it("工具 A 的分页响应不能覆盖用户后来查询的 B", async () => {
    const source = new FakeSource();
    const generated = new Set<string>();
    const signature = { origin: "https://a8.7x24cc.com", path: "/action", action: "app.media.queryChatRecord" };
    const observer = new ListQueryObserver(source, signature, undefined, template => generated.delete(template.envelope.action_id ?? ""));
    observer.start();
    let ownEnvelope!: Record<string, string>;
    const executor = new PlaywrightActionExecutor({ evaluate: async (_fn, arg) => { ownEnvelope = arg.envelope; return { status: 200, ok: true, body: {} }; } }, new ReadonlyRequestPolicy({ origin: signature.origin, operations: [{ operation: "conversation-list", method: "POST", pathnamePattern: "^/action$", action: signature.action }] }), id => generated.add(id));
    await executor.execute("conversation-list", { method: "POST", url: `${signature.origin}/action`, action: signature.action, data: {}, envelope: {} }, signature.action, { create_begin_time: "A" });
    const emit = (envelope: Record<string, string>) => source.emit({ status: () => 200, request: () => ({ method: () => "POST", url: () => `${signature.origin}/action`, postData: () => new URLSearchParams(envelope).toString() }), json: async () => ({ success: true }) });
    emit({ action: signature.action, data: JSON.stringify({ create_begin_time: "B" }), action_id: "user-query" });
    await Promise.resolve();
    emit(ownEnvelope);
    await Promise.resolve();
    expect(observer.getLatest()?.data.create_begin_time).toBe("B");
    observer.stop();
  });
  it("停止后忽略尚未完成的响应，不再通知桌面窗口", async () => {
    const source = new FakeSource();
    let notified = false;
    let resolve!: (body: unknown) => void;
    const pending = new Promise(resolveBody => { resolve = resolveBody; });
    const observer = new ListQueryObserver(source, { origin: "https://a8.7x24cc.com", path: "/action", action: "app.media.queryChatRecord" }, () => { notified = true; });
    observer.start();
    source.emit({ status: () => 200, request: () => ({ method: () => "POST", url: () => "https://a8.7x24cc.com/action", postData: () => new URLSearchParams({ action: "app.media.queryChatRecord", data: "{}" }).toString() }), json: () => pending });
    observer.stop();
    resolve({ success: true });
    await Promise.resolve();
    expect(notified).toBe(false);
    expect(observer.getLatest()).toBeUndefined();
  });
  it("只保存最近一次成功的已审核列表查询模板", async () => {
    const source = new FakeSource();
    const observer = new ListQueryObserver(source, {
      origin: "https://a8.7x24cc.com",
      path: "/action",
      action: "app.media.queryChatRecord"
    });
    observer.start();

    const body = new URLSearchParams({
      action: "app.media.queryChatRecord",
      data: JSON.stringify({ Status: "finish", page: 1, limit: 10 }),
      sessionId: "session-placeholder"
    }).toString();
    source.emit({
      status: () => 200,
      request: () => ({ method: () => "POST", url: () => "https://a8.7x24cc.com/action", postData: () => body }),
      json: async () => ({ success: true, list: [], count: 0 })
    });
    await Promise.resolve();

    expect(observer.getLatest()?.action).toBe("app.media.queryChatRecord");
    expect(observer.getLatest()?.data).toEqual({ Status: "finish", page: 1, limit: 10 });
    observer.stop();
  });

  it("忽略写动作和失败响应", async () => {
    const source = new FakeSource();
    const observer = new ListQueryObserver(source, {
      origin: "https://a8.7x24cc.com",
      path: "/action",
      action: "app.media.queryChatRecord"
    });
    observer.start();
    const body = new URLSearchParams({
      action: "app.media.updateSessionRemark",
      data: "{}"
    }).toString();
    source.emit({
      status: () => 200,
      request: () => ({ method: () => "POST", url: () => "https://a8.7x24cc.com/action", postData: () => body }),
      json: async () => ({ success: true })
    });
    await Promise.resolve();

    expect(observer.getLatest()).toBeUndefined();
  });
});
