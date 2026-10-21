import { mkdir } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright-core";
import { PlaywrightActionExecutor, type ActionPage } from "../browser/action-request.js";
import { launchDedicatedEdge } from "../browser/edge-launcher.js";
import { assertTargetPage, waitForTargetPage } from "../browser/page-guard.js";
import { ListQueryObserver, type ResponseEventSource } from "../browser/request-observer.js";
import { GLOBAL_REQUEST_INTERVAL_MS } from "../config/constants.js";
import type { AppPaths } from "../domain/types.js";
import { WorkbookWriter } from "../export/workbook-writer.js";
import { FileJobStore } from "../jobs/checkpoint-store.js";
import { ExportJob } from "../jobs/export-job.js";
import { runExportFlow } from "../jobs/export-flow.js";
import { GlobalStartRateLimiter } from "../jobs/rate-limiter.js";
import { ApiMessageCollector } from "../messages/api-collector.js";
import { ListCollector } from "../query/list-collector.js";
import { loadSiteContract } from "../reconnaissance/contract-schema.js";
import { ReadonlyRequestPolicy } from "../security/request-policy.js";
import type { BrowserHooks, DesktopRuntime } from "./controller.js";

export function createDesktopRuntime(contractPath: string, paths: AppPaths): DesktopRuntime {
  const contract = loadSiteContract(contractPath);
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let observer: ListQueryObserver | undefined;
  let closingBrowser: Promise<void> | undefined;
  let closeCurrent: (() => Promise<void>) | undefined;
  const toolRequestIds = new Set<string>();

  const disposeObserver = (): void => { observer?.stop(); observer = undefined; };
  return {
    get outputDir() { return paths.outputDir; },
    set outputDir(directory: string) { paths.outputDir = directory; },
    async openBrowser(hooks: BrowserHooks) {
      if (closingBrowser) await closingBrowser;
      if (context && page && !page.isClosed()) { await page.bringToFront(); return; }
      await Promise.all([paths.appRoot, paths.profileDir, paths.jobsDir].map(folder => mkdir(folder, { recursive: true })));
      let opened: BrowserContext;
      try { opened = await launchDedicatedEdge(paths); }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (/SingletonLock|ProcessSingleton|user data directory is already in use|process exited|Target.*closed/i.test(detail)) {
          throw new Error("专用 Edge 启动失败，可能被原批处理工具占用。请先关闭原工具的专用 Edge，再重试。");
        }
        throw error;
      }
      context = opened;
      page = opened.pages().find(item => item.url().startsWith(contract.origin)) ?? opened.pages()[0] ?? await opened.newPage();
      const currentPage = page;
      let ownedClosing: Promise<void> | undefined;
      const closeOwned = (): Promise<void> => {
        if (ownedClosing) return ownedClosing;
        disposeObserver();
        hooks.closing?.();
        ownedClosing = Promise.resolve().then(async () => {
          await opened.close();
          if (context === opened) {
            context = undefined;
            page = undefined;
            closeCurrent = undefined;
            toolRequestIds.clear();
            hooks.disconnect();
          }
          if (closingBrowser === ownedClosing) closingBrowser = undefined;
        });
        closingBrowser = ownedClosing;
        return ownedClosing;
      };
      closeCurrent = closeOwned;
      opened.once("close", () => { void closeOwned().catch(() => undefined); });
      currentPage.once("close", () => { void closeOwned().catch(() => undefined); });
      currentPage.on("framenavigated", frame => { if (page === currentPage && frame === currentPage.mainFrame()) hooks.query(undefined); });
      const operation = contract.operations.find(item => item.operation === "conversation-list")!;
      observer = new ListQueryObserver(currentPage as unknown as ResponseEventSource, { origin: contract.origin, path: "/action", action: operation.action }, template => { if (page === currentPage) hooks.query(template); }, template => toolRequestIds.delete(template.envelope.action_id ?? ""));
      observer.start();
      try {
        await currentPage.goto(`${contract.origin}/${contract.page.hash}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        // 登录可能跳回后台首页；沿用原工具的等待和高级查询导航。
        void waitForTargetPage(currentPage, contract).catch(() => undefined);
      } catch (error) {
        disposeObserver();
        await closeOwned();
        throw new Error(`后台打开失败，请检查网络后重试：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    },
    async validateQuery() {
      if (!page || page.isClosed()) throw new Error("专用浏览器已关闭，请重新打开后台。");
      await assertTargetPage(page, contract);
    },
    async export(template, senderSelection, signal, progress) {
      if (!page || page.isClosed()) throw new Error("专用浏览器已关闭");
      const outputDir = paths.outputDir;
      if (!outputDir) throw new Error("请先选择 Excel 保存位置。");
      await mkdir(outputDir, { recursive: true });
      const executor = new PlaywrightActionExecutor(page as unknown as ActionPage, new ReadonlyRequestPolicy(contract), (actionId, operation) => { if (operation === "conversation-list") toolRequestIds.add(actionId); });
      const collected = await new ListCollector(contract, executor).collect(template, undefined, signal);
      if (collected.conversations.length === 0) throw new Error("当前筛选结果没有可导出的会话，请调整条件并重新查询。");
      const store = new FileJobStore(paths.jobsDir);
      const job = new ExportJob(new ApiMessageCollector(contract, executor, template), store, new GlobalStartRateLimiter(GLOBAL_REQUEST_INTERVAL_MS));
      const writer = new WorkbookWriter(outputDir);
      const result = await runExportFlow(collected, store, job, { writeAndFinalize: checkpoint => writer.writeAndFinalize(checkpoint, senderSelection) }, progress, signal);
      const values = Object.values(result.checkpoint.results);
      progress({ total: result.checkpoint.conversations.length, completed: values.length,
        success: values.filter(item => item.status === "success").length,
        partial: values.filter(item => item.status === "partial").length,
        failed: values.filter(item => item.status === "failed").length });
      return { output: result.output, complete: result.complete };
    },
    async closeBrowser() {
      if (closingBrowser) await closingBrowser;
      if (closeCurrent) await closeCurrent();
    }
  };
}
