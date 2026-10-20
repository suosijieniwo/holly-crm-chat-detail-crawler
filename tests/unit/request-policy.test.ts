import { describe, expect, it } from "vitest";

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

describe("ReadonlyRequestPolicy", () => {
  const policy = new ReadonlyRequestPolicy(contract);

  it("仅允许同源且已审核的 GET 或只读 POST", () => {
    expect(() =>
      policy.assertAllowed({
        method: "POST",
        url: "https://a8.7x24cc.com/action",
        operation: "conversation-list",
        action: "app.media.queryChatRecord"
      })
    ).not.toThrow();
    expect(() =>
      policy.assertAllowed({
        method: "DELETE",
        url: "https://a8.7x24cc.com/action",
        operation: "conversation-list",
        action: "app.media.queryChatRecord"
      })
    ).toThrow("禁止写操作");
    expect(() =>
      policy.assertAllowed({
        method: "POST",
        url: "https://evil.example/action",
        operation: "message-detail",
        action: "app.media.getSessionRecord"
      })
    ).toThrow("禁止跨域请求");
    expect(() =>
      policy.assertAllowed({
        method: "POST",
        url: "https://a8.7x24cc.com/api/unreviewed",
        operation: "conversation-list",
        action: "app.media.queryChatRecord"
      })
    ).toThrow("请求不在只读白名单");
  });

  it("同一路径下动作名不匹配时拒绝请求", () => {
    expect(() =>
      policy.assertAllowed({
        method: "POST",
        url: "https://a8.7x24cc.com/action",
        operation: "message-detail",
        action: "app.media.updateSessionRemark"
      })
    ).toThrow("请求不在只读白名单");
  });
});
