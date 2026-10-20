import type { ActionRequestTemplate } from "../browser/action-request.js";
import { hasMeaningfulFilter } from "../browser/page-guard.js";
import type { ExportProgress } from "../jobs/export-job.js";

export interface BrowserHooks {
  query(template: ActionRequestTemplate | undefined): void;
  closing?(): void;
  disconnect(): void;
}

export interface DesktopRuntime {
  outputDir: string;
  openBrowser(hooks: BrowserHooks): Promise<void>;
  validateQuery(): Promise<void>;
  export(template: ActionRequestTemplate, signal: AbortSignal, progress: (value: ExportProgress) => void): Promise<{ output: string; complete: boolean }>;
  closeBrowser(): Promise<void>;
}

export interface DesktopState {
  browser: "closed" | "opening" | "open" | "closing";
  task: "idle" | "running" | "stopping" | "completed" | "cancelled" | "error";
  message: string;
  queryReady: boolean;
  querySummary: string;
  progress?: Omit<ExportProgress, "currentConversationId">;
  outputDir: string;
  output?: string;
  complete?: boolean;
  saveFailed?: boolean;
}

function summarize(template?: ActionRequestTemplate): string {
  if (!template) return "尚未识别查询，请先在后台点击“查询”。";
  const data = template.data;
  const dates = [data.create_begin_time, data.create_end_time].filter(value => typeof value === "string" && value).join(" 至 ");
  const labels: Record<string, string> = { ChannelId: "渠道", sessionTag: "标签", DepAgentId: "客服", SkillGroupId: "技能组", VisitorId: "访客", satisfactionConfig: "满意度", Status: "状态" };
  const filters = Object.entries(labels).filter(([key]) => hasMeaningfulFilter({ [key]: data[key] })).map(([, label]) => `${label}已设置`);
  return [dates, ...filters].filter(Boolean).join(" · ") || "已识别后台查询条件";
}

export class DesktopController {
  private state: DesktopState;
  private latest?: ActionRequestTemplate;
  private opening?: Promise<void>;
  private active?: Promise<void>;
  private cancellation?: AbortController;
  private closing = false;
  private saveFailed = false;

  constructor(private readonly runtime: DesktopRuntime, private readonly onState: (state: DesktopState) => void = () => {}) {
    this.state = {
      browser: "closed", task: "idle", message: "先打开后台，在专用 Edge 中登录并查询。",
      queryReady: false, querySummary: summarize(), outputDir: runtime.outputDir
    };
  }

  getState(): DesktopState { return structuredClone(this.state); }

  private update(value: Partial<DesktopState>): void {
    Object.assign(this.state, value);
    this.onState(this.getState());
  }

  private readonly hooks: BrowserHooks = {
    closing: () => {
      this.latest = undefined;
      this.update({ browser: "closing", queryReady: false, querySummary: summarize() });
      if (this.active) this.cancellation?.abort(new Error("专用浏览器正在关闭，任务已停止；已有断点保留。"));
      else if (!this.closing) this.update({ message: "正在退出专用 Edge，请等待完成。" });
    },
    query: template => {
      this.latest = template ? structuredClone(template) : undefined;
      if (this.active) return;
      this.update({ queryReady: Boolean(template && hasMeaningfulFilter(template.data)), querySummary: summarize(template) });
    },
    disconnect: () => {
      this.latest = undefined;
      this.update({ browser: "closed", queryReady: false, querySummary: summarize() });
      if (this.active) this.cancellation?.abort(new Error("专用浏览器已关闭，任务已停止；已有断点保留。"));
      else if (!this.closing) this.update({ message: "专用浏览器已关闭，点击“打开后台”重新连接。" });
    }
  };

  async openBrowser(): Promise<void> {
    if (this.closing) throw new Error("工具正在关闭");
    if (this.opening) return this.opening;
    const alreadyOpen = this.state.browser === "open";
    if (!alreadyOpen) this.update({ browser: "opening", message: "正在打开专用 Edge…" });
    this.opening = this.runtime.openBrowser(this.hooks).then(() => {
      this.update({ browser: "open", ...(!alreadyOpen ? { message: "在 Edge 中登录，设置筛选条件并点击“查询”。" } : {}) });
    }).catch(error => {
      this.latest = undefined;
      this.update({ browser: "closed", queryReady: false, message: error instanceof Error ? error.message : "打开后台失败" });
      throw error;
    }).finally(() => { this.opening = undefined; });
    return this.opening;
  }

  async startExport(): Promise<void> {
    if (this.closing || this.active) throw new Error("任务正在运行或关闭，请等待完成。");
    if (this.state.browser !== "open" || !this.latest) throw new Error("请先打开浏览器，设置条件并点击后台“查询”。");
    if (!hasMeaningfulFilter(this.latest.data)) throw new Error("至少设置一个日期、渠道、标签或用户等筛选条件。");
    const template = structuredClone(this.latest);
    this.cancellation = new AbortController();
    this.saveFailed = false;
    this.update({ task: "running", message: "正在检查查询并固定会话列表…", progress: undefined, complete: undefined, output: undefined, saveFailed: false, querySummary: summarize(template) });
    this.active = this.execute(template, this.cancellation.signal);
    try { await this.active; }
    finally {
      this.active = undefined;
      this.cancellation = undefined;
      this.update({ queryReady: Boolean(this.latest && hasMeaningfulFilter(this.latest.data)), querySummary: summarize(this.latest) });
    }
  }

  private async execute(template: ActionRequestTemplate, signal: AbortSignal): Promise<void> {
    try {
      await this.runtime.validateQuery();
      signal.throwIfAborted();
      const result = await this.runtime.export(template, signal, value => {
        const { total, completed, success, partial, failed } = value;
        this.update({ progress: { total, completed, success, partial, failed }, ...(signal.aborted ? {} : { message: "正在采集会话，完成后自动生成 Excel。" }) });
      });
      signal.throwIfAborted();
      this.update({ task: "completed", output: result.output, complete: result.complete,
        message: result.complete ? "导出完成，Excel 已校验。" : "Excel 已生成，部分会话未完整；断点已保留，相同筛选可重试。" });
    } catch (error) {
      const failedSaving = error instanceof AggregateError;
      this.saveFailed = failedSaving;
      if (signal.aborted && !failedSaving) {
        this.update({ task: "cancelled", message: signal.reason instanceof Error ? signal.reason.message : "已停止；已有断点保留，相同筛选可继续。" });
      } else {
        if (!signal.aborted) this.latest = undefined;
        this.update({ task: "error", saveFailed: failedSaving, message: error instanceof Error ? error.message : "导出失败，请重新查询后重试。" });
      }
    }
  }

  async stopExport(): Promise<void> {
    if (!this.active) return;
    this.update({ task: "stopping", message: "正在停止并保存进度，请稍候…" });
    this.cancellation?.abort(new Error("已停止；已有任务断点保留，下次使用相同筛选可继续。"));
    await this.active;
  }

  async close(allowUnsavedExit = false): Promise<void> {
    this.closing = true;
    try {
      if (this.opening) await this.opening.catch(() => undefined);
      await this.stopExport();
      if (this.saveFailed && !allowUnsavedExit) throw new Error(this.state.message);
      await this.runtime.closeBrowser();
      this.latest = undefined;
      this.update({ browser: "closed", queryReady: false });
    } catch (error) {
      this.closing = false;
      throw error;
    }
  }
}
