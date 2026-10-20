import { describe, expect, it } from "vitest";

import type { SiteContract } from "../../src/domain/types.js";
import {
  assertTargetPage,
  hasMeaningfulFilter,
  shouldNavigateToTarget,
  waitForTargetPage
} from "../../src/browser/page-guard.js";

const contract = {
  origin: "https://a8.7x24cc.com",
  page: {
    hash: "#/media/chat_record_advanced_query",
    requiredTexts: ["查询"],
    queryFormSelector: ".query-form",
    resultTableSelector: ".result-table"
  }
} as SiteContract;

describe("hasMeaningfulFilter", () => {
  it("空字符串、空数组和系统分页不算人工筛选", () => {
    expect(hasMeaningfulFilter({ page: 1, limit: 10, Status: "", ChannelId: [] })).toBe(false);
  });

  it("日期、用户ID或标签等任一条件存在时允许固定快照", () => {
    expect(hasMeaningfulFilter({ page: 1, limit: 10, create_begin_time: "2026-08-03" })).toBe(true);
    expect(hasMeaningfulFilter({ VisitorId: "fictional-user" })).toBe(true);
  });
});

describe("目标页面恢复", () => {
  it("地址栏停留在父级路由但高级查询界面已渲染时仍应允许导出", async () => {
    const page = {
      url: () => "https://a8.7x24cc.com/#/media",
      locator: (selector: string) => ({
        count: async () =>
          selector === contract.page.queryFormSelector ||
          selector === contract.page.resultTableSelector
            ? 1
            : 0
      })
    };

    await expect(assertTargetPage(page as never, contract)).resolves.toBeUndefined();
  });

  it("即使界面结构相似，也不能在其他站点启动导出", async () => {
    const page = {
      url: () => "https://example.com/#/media",
      locator: () => ({ count: async () => 1 })
    };

    await expect(assertTargetPage(page as never, contract)).rejects.toThrow(
      "请停留在“会话记录高级查询”页面后再开始导出"
    );
  });

  it("登录完成回到同源首页时应自动进入高级查询页", () => {
    expect(
      shouldNavigateToTarget("https://a8.7x24cc.com/#/home", "合力亿捷云客服", contract)
    ).toBe(true);
  });

  it("仍在登录页时不抢占用户输入", () => {
    expect(
      shouldNavigateToTarget("https://a8.7x24cc.com/#/login", "登录-合力亿捷", contract)
    ).toBe(false);
  });

  it("等待期间会把已登录首页导航回目标页并完成识别", async () => {
    let currentUrl = "https://a8.7x24cc.com/#/home";
    const navigations: string[] = [];
    const page = {
      url: () => currentUrl,
      title: async () => "合力亿捷云客服",
      goto: async (url: string) => {
        navigations.push(url);
        currentUrl = url;
        return null;
      },
      waitForTimeout: async () => undefined,
      locator: () => ({ count: async () => (currentUrl.includes("chat_record_advanced_query") ? 1 : 0) })
    };

    await waitForTargetPage(page as never, contract, 100);

    expect(navigations).toEqual([
      "https://a8.7x24cc.com/#/media/chat_record_advanced_query"
    ]);
  });
});
