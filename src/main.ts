import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright-core";

import { PlaywrightActionExecutor, type ActionPage } from "./browser/action-request.js";
import { ControlPanel } from "./browser/control-panel.js";
import { launchDedicatedEdge } from "./browser/edge-launcher.js";
import { assertTargetPage, hasMeaningfulFilter, waitForTargetPage } from "./browser/page-guard.js";
import {
  ListQueryObserver,
  type ResponseEventSource
} from "./browser/request-observer.js";
import { GLOBAL_REQUEST_INTERVAL_MS, TARGET_ORIGIN } from "./config/constants.js";
import { resolveAppPaths } from "./config/paths.js";
import { WorkbookWriter } from "./export/workbook-writer.js";
import { FileJobStore } from "./jobs/checkpoint-store.js";
import { ExportJob } from "./jobs/export-job.js";
import { runExportFlow, waitForStart } from "./jobs/export-flow.js";
import { GlobalStartRateLimiter } from "./jobs/rate-limiter.js";
import { ApiMessageCollector } from "./messages/api-collector.js";
import { ListCollector } from "./query/list-collector.js";
import { loadSiteContract } from "./reconnaissance/contract-schema.js";
import { ReadonlyRequestPolicy } from "./security/request-policy.js";

function openOutputFolder(folder: string): void {
  const child = spawn("explorer.exe", [folder], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function choosePage(contextPages: Page[]): Promise<Page> {
  return contextPages.find((item) => item.url().startsWith(TARGET_ORIGIN)) ?? contextPages[0]!;
}

export async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const contract = loadSiteContract(path.join(projectRoot, "config", "site-contract.local.json"));
  const paths = resolveAppPaths();
  await Promise.all([
    mkdir(paths.appRoot, { recursive: true }),
    mkdir(paths.profileDir, { recursive: true }),
    mkdir(paths.jobsDir, { recursive: true }),
    mkdir(paths.outputDir, { recursive: true })
  ]);

  const context = await launchDedicatedEdge(paths);
  const page = await choosePage(context.pages().length > 0 ? context.pages() : [await context.newPage()]);
  const listOperation = contract.operations.find((item) => item.operation === "conversation-list")!;
  const observer = new ListQueryObserver(page as unknown as ResponseEventSource, {
    origin: contract.origin,
    path: "/action",
    action: listOperation.action
  });
  observer.start();
  let panel: ControlPanel | undefined;
  const cancellation = new AbortController();
  try {
    if (new URL(page.url() || "about:blank").origin !== contract.origin || new URL(page.url() || "about:blank").hash !== contract.page.hash) {
      await page.goto(`${contract.origin}/${contract.page.hash}`, { waitUntil: "domcontentloaded" });
    }
    console.log("请在打开的专用 Edge 中手动登录，然后进入会话记录高级查询页面。");
    await waitForTargetPage(page, contract);

    panel = new ControlPanel(page);
    let startResolve!: (template: NonNullable<ReturnType<ListQueryObserver["getLatest"]>>) => void;
    const startPromise = new Promise<NonNullable<ReturnType<ListQueryObserver["getLatest"]>>>((resolve) => {
      startResolve = resolve;
    });
    let started = false;
    await panel.install(
      async () => {
        try {
          await assertTargetPage(page, contract);
          const latest = observer.getLatest();
          if (!latest) return { ok: false, message: "请先在网页设置筛选条件并点击“查询”。" };
          if (!hasMeaningfulFilter(latest.data)) {
            return { ok: false, message: "至少设置一个日期、渠道、标签或用户等筛选条件，避免误导出全部会话。" };
          }
          if (!started) {
            started = true;
            startResolve(latest);
          }
          return { ok: true, message: "已开始冻结当前筛选结果，请勿修改网页筛选条件。" };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "页面状态检查失败" };
        }
      },
      async () => {
        cancellation.abort(new Error("用户取消导出"));
        return { ok: true, message: "正在停止，已完成内容会保存在本机断点中。" };
      }
    );
    console.log("已识别高级查询页面，右下角导出面板已就绪。请完成网页筛选和查询后点击“开始导出”。");

    const template = await waitForStart(startPromise, cancellation.signal);
    await panel.update({ message: "正在固定全部会话列表……", running: true });
    const policy = new ReadonlyRequestPolicy(contract);
    const executor = new PlaywrightActionExecutor(page as unknown as ActionPage, policy);
    const listResult = await new ListCollector(contract, executor).collect(
      template,
      undefined,
      cancellation.signal
    );
    if (listResult.conversations.length === 0) throw new Error("当前筛选结果没有可导出的会话");

    const store = new FileJobStore(paths.jobsDir);
    const collector = new ApiMessageCollector(contract, executor, template);
    const job = new ExportJob(
      collector,
      store,
      new GlobalStartRateLimiter(GLOBAL_REQUEST_INTERVAL_MS)
    );

    const result = await runExportFlow(
      listResult,
      store,
      job,
      new WorkbookWriter(paths.outputDir),
      (progress) => {
        void panel!
          .update({
            message: `正在导出：${progress.completed}/${progress.total}\n成功 ${progress.success}，部分成功 ${progress.partial}，失败 ${progress.failed}`,
            progress: { completed: progress.completed, total: progress.total },
            running: true
          })
          .catch(() => undefined);
      },
      cancellation.signal
    );
    await panel.update({
      title: result.complete ? "导出完成" : "Excel 已生成，采集未完整",
      message: `Excel 已生成：\n${result.output}${result.complete ? "" : "\n仍有部分成功或失败会话，断点已保留；下次相同筛选将重试。"}`,
      progress: { completed: result.checkpoint.conversations.length, total: result.checkpoint.conversations.length },
      running: false,
      completed: true
    });
    console.log(`Excel 已生成：${result.output}${result.complete ? "" : "；未完成断点已保留"}`);
    openOutputFolder(paths.outputDir);
  } catch (error) {
    const message = error instanceof AggregateError
      ? error.message
      : cancellation.signal.aborted
        ? "导出已停止；已有任务断点予以保留，下次使用相同筛选可继续。"
        : error instanceof Error
        ? error.message
        : "导出失败。";
    await panel?.update({ title: "导出未完成", message: `${message}\n请重新启动工具后使用相同筛选继续。`, running: false, completed: true });
    console.error(message);
  } finally {
    observer.stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "工具启动失败");
    process.exitCode = 1;
  });
}
