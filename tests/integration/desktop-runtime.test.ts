import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ launch: vi.fn(), collect: vi.fn(), flow: vi.fn(), write: vi.fn() }));
vi.mock("../../src/browser/edge-launcher.js", () => ({ launchDedicatedEdge: state.launch }));
vi.mock("node:fs/promises", async original => ({ ...await original<object>(), mkdir: vi.fn() }));
vi.mock("../../src/query/list-collector.js", () => ({ ListCollector: class { collect = state.collect; } }));
vi.mock("../../src/jobs/export-flow.js", () => ({ runExportFlow: state.flow }));
vi.mock("../../src/export/workbook-writer.js", () => ({ WorkbookWriter: class { writeAndFinalize = state.write; } }));
import { createDesktopRuntime } from "../../src/desktop/runtime.js";

describe("desktop runtime", () => {
  it("专用页面关闭时清理整个所属上下文，且仅通知一次断开", async () => {
    const page = Object.assign(new EventEmitter(), { url: () => "about:blank", isClosed: () => false, goto: vi.fn(async () => {}), bringToFront: vi.fn(async () => {}), mainFrame: () => undefined });
    const context = Object.assign(new EventEmitter(), { pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => { context.emit("close"); }) });
    state.launch.mockResolvedValue(context);
    const runtime = createDesktopRuntime(path.resolve("config/site-contract.local.json"), { appRoot: "C:\\test", profileDir: "C:\\test\\profile", jobsDir: "C:\\test\\jobs", outputDir: "C:\\test\\output" });
    const hooks = { query: vi.fn(), disconnect: vi.fn() };
    await runtime.openBrowser(hooks);
    page.emit("close");
    await vi.waitFor(() => expect(hooks.disconnect).toHaveBeenCalledOnce());
    expect(context.close).toHaveBeenCalledOnce();
    expect(hooks.disconnect).toHaveBeenCalledOnce();
    await runtime.closeBrowser();
    expect(hooks.disconnect).toHaveBeenCalledOnce();
  });
  it("旧 Edge 完全退出前不发布已断开、不允许重开，退出操作也会等待", async () => {
    const page = Object.assign(new EventEmitter(), { isClosed: () => true, url: () => "about:blank", goto: vi.fn(async () => {}), mainFrame: () => undefined });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const context = Object.assign(new EventEmitter(), { pages: () => [page], newPage: vi.fn(), close: vi.fn(() => gate) });
    state.launch.mockReset().mockResolvedValue(context);
    const runtime = createDesktopRuntime(path.resolve("config/site-contract.local.json"), { appRoot: "C:\\test", profileDir: "C:\\test\\profile", jobsDir: "C:\\test\\jobs", outputDir: "C:\\test\\output" });
    const hooks = { query: vi.fn(), disconnect: vi.fn(), closing: vi.fn() };
    await runtime.openBrowser(hooks);
    page.emit("close");
    const reopening = runtime.openBrowser(hooks);
    let closed = false;
    const closing = runtime.closeBrowser().then(() => { closed = true; });
    await Promise.resolve();
    expect(hooks.closing).toHaveBeenCalledOnce();
    expect(hooks.disconnect).not.toHaveBeenCalled();
    expect(state.launch).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    release();
    await Promise.all([reopening, closing]);
  });
  it("恢复断点后的最终总数按冻结列表计算", async () => {
    const page = Object.assign(new EventEmitter(), { isClosed: () => false, url: () => "about:blank", goto: vi.fn(async () => {}), mainFrame: () => undefined });
    const context = Object.assign(new EventEmitter(), { pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => {}) });
    state.launch.mockReset().mockResolvedValue(context);
    state.collect.mockResolvedValue({ conversations: [{ conversationId: "one" }, { conversationId: "two" }] });
    state.flow.mockResolvedValue({ output: "C:\\test.xlsx", complete: true, checkpoint: { conversations: [{ conversationId: "one" }], results: { one: { status: "success" } } } });
    const runtime = createDesktopRuntime(path.resolve("config/site-contract.local.json"), { appRoot: "C:\\test", profileDir: "C:\\test\\profile", jobsDir: "C:\\test\\jobs", outputDir: "C:\\test\\output" });
    await runtime.openBrowser({ query() {}, disconnect() {} });
    const progress = vi.fn();
    await runtime.export({ method: "POST", url: "https://a8.7x24cc.com/action", action: "app.media.queryChatRecord", data: {}, envelope: {} }, ["bot"], new AbortController().signal, progress);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ total: 1, completed: 1 }));
    await runtime.closeBrowser();
  });

  it("把桌面选择的发送方传给最终工作簿写出", async () => {
    const page = Object.assign(new EventEmitter(), { url: () => "about:blank", isClosed: () => false, goto: vi.fn(async () => {}), bringToFront: vi.fn(async () => {}), mainFrame: () => undefined });
    const context = Object.assign(new EventEmitter(), { pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => {}) });
    state.launch.mockReset().mockResolvedValue(context);
    state.collect.mockResolvedValue({ conversations: [{ conversationId: "one" }] });
    const checkpoint = { conversations: [{ conversationId: "one" }], results: { one: { status: "success" } } };
    state.write.mockReset().mockResolvedValue("C:\\test.xlsx");
    state.flow.mockReset().mockImplementationOnce(async (_collected, _store, _job, writer) => ({
      output: await writer.writeAndFinalize(checkpoint), complete: true, checkpoint
    }));
    const runtime = createDesktopRuntime(path.resolve("config/site-contract.local.json"), { appRoot: "C:\\test", profileDir: "C:\\test\\profile", jobsDir: "C:\\test\\jobs", outputDir: "C:\\test\\output" });
    await runtime.openBrowser({ query() {}, disconnect() {} });
    await runtime.export({ method: "POST", url: "https://a8.7x24cc.com/action", action: "app.media.queryChatRecord", data: {}, envelope: {} }, ["bot"], new AbortController().signal, vi.fn());
    expect(state.write).toHaveBeenCalledWith(checkpoint, ["bot"]);
    await runtime.closeBrowser();
  });
});
