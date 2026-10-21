import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { findEdgeExecutable } from "../../src/browser/edge-launcher.js";

let browser: Browser;
async function openUI(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1120, height: 760 } });
  await page.addInitScript(() => {
    const state = { browser: "closed", task: "idle", message: "先打开后台，在专用 Edge 中登录并查询。", queryReady: false, querySummary: "尚未识别查询，请先在后台点击“查询”。", outputDir: "" };
    const target = window as any;
    target.__calls = [];
    target.exporter = {
      getState: async () => ({ ok: true, value: state }),
      onState: (handler: any) => { target.__update = handler; },
      ...Object.fromEntries(["openBrowser", "startExport", "stopExport", "selectOutputDirectory", "openOutputFolder", "openLatestFile", "clearJobs", "clearLogin"].map(name => [name, async () => {
        target.__calls.push(name);
        return name === "clearJobs" ? { ok: false, error: "请先停止任务" } : { ok: true, value: true };
      }]))
    };
    target.__state = state;
  });
  await page.goto(pathToFileURL(path.resolve("desktop/index.html")).href);
  await page.waitForFunction(() => typeof (window as any).__update === "function");
  return page;
}
beforeAll(async () => {
  browser = await chromium.launch({ executablePath: await findEdgeExecutable(), headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); }, 30000);

describe("desktop UI", () => {
  it("首次提示选择位置；选择后保留两个打开按钮并可更换，导出时锁定更换", async () => {
    const page = await openUI();
    expect(await page.locator("#output-dir").textContent()).toContain("首次");
    expect(await page.locator("#select-output").isVisible()).toBe(true);
    expect(await page.locator("#open-file").isVisible()).toBe(false);
    expect(await page.locator("#open-folder").isVisible()).toBe(false);
    await page.locator("#select-output").click();
    expect(await page.evaluate(() => (window as any).__calls)).toContain("selectOutputDirectory");
    expect(await page.locator("#select-output").isVisible()).toBe(true);
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, outputDir: "D:\\导出文件", task: "completed", output: "D:\\导出文件\\result.xlsx" }));
    expect(await page.locator("#select-output").isVisible()).toBe(false);
    expect(await page.locator("#change-output").isVisible()).toBe(true);
    expect(await page.locator("#open-file").isEnabled()).toBe(true);
    expect(await page.locator("#open-folder").isVisible()).toBe(true);
    await page.locator("#change-output").click();
    expect(await page.evaluate(() => (window as any).__calls.filter((name: string) => name === "selectOutputDirectory").length)).toBe(2);
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, outputDir: "D:\\导出文件", task: "running" }));
    expect(await page.locator("#change-output").isDisabled()).toBe(true);
    await page.close();
  });
  it("默认空状态不显示虚构数据，必须识别查询后才允许开始", async () => {
    const page = await openUI();
    expect(await page.locator("#start-export").isDisabled()).toBe(true);
    expect(await page.locator("#count-success").textContent()).toBe("—");
    await page.locator("#open-browser").click();
    expect(await page.evaluate(() => (window as any).__calls)).toContain("openBrowser");
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, browser: "open", queryReady: true, querySummary: "2026-10-19" }));
    expect(await page.locator("#start-export").isEnabled()).toBe(true);
    await page.close();
  });
  it("真实状态驱动进度、停止和再次开始；未完整结果不冒充完整成功", async () => {
    const page = await openUI();
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, browser: "open", queryReady: true, task: "running", progress: { total: 10, completed: 4, success: 3, partial: 1, failed: 0 } }));
    expect(await page.locator("#start-export").isDisabled()).toBe(true);
    expect(await page.locator("#stop-export").isEnabled()).toBe(true);
    expect(await page.locator("#count-success").textContent()).toBe("3");
    expect(await page.locator("[role=progressbar]").getAttribute("aria-valuenow")).toBe("40");
    await page.locator("#stop-export").click();
    expect(await page.evaluate(() => (window as any).__calls)).toContain("stopExport");
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, browser: "open", queryReady: true, task: "completed", complete: false, output: "C:\\output\\result.xlsx", message: "Excel 已生成，部分会话未完整" }));
    expect(await page.locator("#start-export").isEnabled()).toBe(true);
    expect(await page.locator("#open-file").isEnabled()).toBe(true);
    expect(await page.locator("#task-label").textContent()).toContain("未完整");
    await page.close();
  });
  it("错误以文本显示、设置可关闭，较小窗口没有横向溢出", async () => {
    const page = await openUI();
    await page.locator("#settings-button").click();
    expect(await page.locator("#settings-dialog").isVisible()).toBe(true);
    await page.locator("#clear-jobs").click();
    expect(await page.locator("#settings-feedback").textContent()).toContain("请先停止任务");
    await page.keyboard.press("Escape");
    expect(await page.locator("#settings-dialog").isVisible()).toBe(false);
    await page.setViewportSize({ width: 820, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => (window as any).__update({ ...(window as any).__state, task: "error", message: '<img src=x onerror="alert(1)">' }));
    expect(await page.locator("#task-message img").count()).toBe(0);
    expect(await page.locator("#task-message").textContent()).toContain("<img");
    await page.close();
  });
});
