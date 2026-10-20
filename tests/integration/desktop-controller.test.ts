import { describe, expect, it, vi } from "vitest";
import { DesktopController, type BrowserHooks, type DesktopRuntime } from "../../src/desktop/controller.js";
import type { ActionRequestTemplate } from "../../src/browser/action-request.js";

const query: ActionRequestTemplate = {
  method: "POST", url: "https://a8.7x24cc.com/action", action: "app.media.queryChatRecord",
  data: { create_begin_time: "2026-10-19", page: 1, limit: 10 }, envelope: { token: "do-not-show" }
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  let hooks!: BrowserHooks;
  const runtime: DesktopRuntime = {
    outputDir: "C:\\Users\\tester\\Desktop\\客服聊天记录导出",
    openBrowser: vi.fn(async value => { hooks = value; }),
    validateQuery: vi.fn(async () => {}),
    export: vi.fn(async (_template, _signal, progress) => {
      progress({ total: 2, completed: 2, success: 1, partial: 1, failed: 0 });
      return { output: "C:\\output\\result.xlsx", complete: false };
    }),
    closeBrowser: vi.fn(async () => {})
  };
  const changes = vi.fn();
  const controller = new DesktopController(runtime, changes);
  return { runtime, controller, changes, hooks: () => hooks };
}

describe("desktop controller", () => {
  it("合并连续打开请求，返回独立状态快照且不暴露查询凭据", async () => {
    const s = setup();
    const opening = deferred<void>();
    vi.mocked(s.runtime.openBrowser).mockImplementationOnce(async () => opening.promise);
    const a = s.controller.openBrowser();
    const b = s.controller.openBrowser();
    expect(s.runtime.openBrowser).toHaveBeenCalledTimes(1);
    opening.resolve();
    await Promise.all([a, b]);
    await s.controller.openBrowser();
    s.hooks().query(query);
    const state = s.controller.getState();
    expect(state.querySummary).toContain("2026-10-19");
    expect(JSON.stringify(state)).not.toContain("do-not-show");
    state.message = "mutated";
    expect(s.controller.getState().message).not.toBe("mutated");
  });

  it("没有查询或没有有效筛选时拒绝开始", async () => {
    const s = setup();
    await expect(s.controller.startExport()).rejects.toThrow(/查询/);
    await s.controller.openBrowser();
    s.hooks().query({ ...query, data: { page: 1, limit: 10 } });
    await expect(s.controller.startExport()).rejects.toThrow(/筛选/);
    expect(s.runtime.export).not.toHaveBeenCalled();
  });

  it("并发开始只执行一次，接收真实进度并允许完成后再次导出", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    const gate = deferred<void>();
    vi.mocked(s.runtime.validateQuery).mockImplementationOnce(() => gate.promise);
    const a = s.controller.startExport();
    await expect(s.controller.startExport()).rejects.toThrow(/正在/);
    gate.resolve();
    await a;
    expect(s.runtime.export).toHaveBeenCalledTimes(1);
    expect(s.controller.getState()).toMatchObject({ task: "completed", complete: false, progress: { total: 2, success: 1, partial: 1 } });
    await s.controller.startExport();
    expect(s.runtime.export).toHaveBeenCalledTimes(2);
  });

  it("停止要等待在途收尾，下一次任务使用新的取消信号", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    const saved = deferred<void>();
    let signal!: AbortSignal;
    vi.mocked(s.runtime.export).mockImplementationOnce(async (_template, value) => {
      signal = value;
      await saved.promise;
      signal.throwIfAborted();
      return { output: "never", complete: true };
    });
    const first = s.controller.startExport();
    await vi.waitFor(() => expect(signal).toBeDefined());
    let stopped = false;
    const stop = s.controller.stopExport().then(() => { stopped = true; });
    expect(signal.aborted).toBe(true);
    expect(s.controller.getState().task).toBe("stopping");
    await Promise.resolve();
    expect(stopped).toBe(false);
    saved.resolve();
    await Promise.all([first, stop]);
    expect(s.controller.getState().task).toBe("cancelled");
    await s.controller.startExport();
    const nextSignal = vi.mocked(s.runtime.export).mock.calls[1]![1];
    expect(nextSignal.aborted).toBe(false);
  });

  it("浏览器断开清空查询并中断任务，不能继续显示可开始", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    s.hooks().disconnect();
    expect(s.controller.getState()).toMatchObject({ browser: "closed", queryReady: false });
    await expect(s.controller.startExport()).rejects.toThrow(/浏览器|查询/);
  });

  it("导航后清除过期查询；后台校验失败不执行采集", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    s.hooks().query(undefined);
    expect(s.controller.getState().queryReady).toBe(false);
    s.hooks().query(query);
    vi.mocked(s.runtime.validateQuery).mockRejectedValueOnce(new Error("登录已失效"));
    await s.controller.startExport();
    expect(s.controller.getState()).toMatchObject({ task: "error", message: "登录已失效", queryReady: false });
    expect(s.runtime.export).not.toHaveBeenCalled();
  });

  it("关闭等待收尾再关闭所属浏览器", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    const gate = deferred<void>();
    vi.mocked(s.runtime.export).mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("已停止");
    });
    const task = s.controller.startExport();
    await vi.waitFor(() => expect(s.runtime.export).toHaveBeenCalledOnce());
    const close = s.controller.close();
    expect(s.runtime.closeBrowser).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([task, close]);
    expect(s.runtime.closeBrowser).toHaveBeenCalledOnce();
    expect(s.controller.getState().task).toBe("cancelled");
  });

  it("关闭时保存失败必须保留窗口供用户处理，不能正常退出", async () => {
    const s = setup();
    await s.controller.openBrowser();
    s.hooks().query(query);
    const gate = deferred<void>();
    vi.mocked(s.runtime.export).mockImplementationOnce(async () => {
      await gate.promise;
      throw new AggregateError([], "断点保存失败：磁盘已满");
    });
    const task = s.controller.startExport();
    await vi.waitFor(() => expect(s.runtime.export).toHaveBeenCalledOnce());
    const closing = s.controller.close();
    const rejected = expect(closing).rejects.toThrow("断点保存失败");
    gate.resolve();
    await Promise.all([task, rejected]);
    expect(s.runtime.closeBrowser).not.toHaveBeenCalled();
    expect(s.controller.getState()).toMatchObject({ task: "error", message: "断点保存失败：磁盘已满" });
    await expect(s.controller.close()).rejects.toThrow("断点保存失败");
    expect(s.runtime.closeBrowser).not.toHaveBeenCalled();
    await s.controller.close(true);
    expect(s.runtime.closeBrowser).toHaveBeenCalledOnce();
  });
});
