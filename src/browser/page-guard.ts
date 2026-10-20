import type { Page } from "playwright-core";

import type { SiteContract } from "../domain/types.js";

const MEANINGFUL_KEYS = new Set([
  "DepAgentId",
  "ChannelId",
  "CusNickName",
  "remarkName",
  "FinishStatus",
  "satisfactionConfig",
  "SkillGroupId",
  "Status",
  "Type",
  "create_begin_time",
  "create_end_time",
  "finish_begin_time",
  "finish_end_time",
  "isValidSession",
  "sessionTag",
  "VisitorId",
  "SequenceId",
  "warningType",
  "sessionType",
  "HelpAgentId",
  "Tagged",
  "sessionPriority",
  "serviceSum",
  "endOrNot",
  "skillGroupOneTimeSolution",
  "agentSessionIds"
]);

function nonEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === false) return false;
  if (Array.isArray(value)) return value.some(nonEmpty);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(nonEmpty);
  if (typeof value === "number") return value !== 0;
  return true;
}

export function hasMeaningfulFilter(data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([key, value]) => MEANINGFUL_KEYS.has(key) && nonEmpty(value));
}

export function shouldNavigateToTarget(
  currentUrl: string,
  title: string,
  contract: SiteContract
): boolean {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return false;
  }
  if (url.origin !== contract.origin || url.hash === contract.page.hash) return false;
  return !/(登录|log\s*in|sign\s*in)/i.test(title);
}

export async function assertTargetPage(page: Page, contract: SiteContract): Promise<void> {
  const url = new URL(page.url());
  if (url.origin !== contract.origin) {
    throw new Error("请停留在“会话记录高级查询”页面后再开始导出");
  }

  const [queryFormCount, resultTableCount] = await Promise.all([
    page.locator(contract.page.queryFormSelector).count(),
    page.locator(contract.page.resultTableSelector).count()
  ]);

  // 该站点在打开高级查询抽屉后，地址栏有时仍停留在 #/media。
  // 因此同源页面以实际渲染出的表单和结果表格为准，不能只依赖 hash。
  if (queryFormCount === 0) {
    if (url.hash !== contract.page.hash) {
      throw new Error("请停留在“会话记录高级查询”页面后再开始导出");
    }
    throw new Error("未识别到高级查询表单，请刷新页面后重试");
  }
  if (resultTableCount === 0) {
    throw new Error("未识别到查询结果表格，请先在网页点击查询");
  }
}

export async function waitForTargetPage(
  page: Page,
  contract: SiteContract,
  timeoutMs = 30 * 60 * 1000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastNavigationAt = 0;
  while (Date.now() < deadline) {
    try {
      await assertTargetPage(page, contract);
      return;
    } catch {
      const now = Date.now();
      const title = await page.title().catch(() => "");
      if (
        now - lastNavigationAt >= 5000 &&
        shouldNavigateToTarget(page.url(), title, contract)
      ) {
        lastNavigationAt = now;
        await page
          .goto(`${contract.origin}/${contract.page.hash}`, { waitUntil: "domcontentloaded" })
          .catch(() => undefined);
      }
      await page.waitForTimeout(1000);
    }
  }
  throw new Error("等待登录和高级查询页面超时，请重新启动工具");
}
