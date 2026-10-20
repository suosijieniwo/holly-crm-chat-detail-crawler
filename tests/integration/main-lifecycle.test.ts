import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  launch: vi.fn(), install: vi.fn(), update: vi.fn(), collect: vi.fn(), stop: vi.fn(),
  template: { method: "POST", url: "https://a8.7x24cc.com/action", action: "app.media.queryChatRecord", data: { create_begin_time: "2026-10-11", page: 1, limit: 10 }, envelope: {} }
}));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<object>(), mkdir: vi.fn() }));
vi.mock("../../src/browser/edge-launcher.js", () => ({ launchDedicatedEdge: state.launch }));
vi.mock("../../src/browser/control-panel.js", () => ({ ControlPanel: class { install = state.install; update = state.update; } }));
vi.mock("../../src/browser/request-observer.js", () => ({ ListQueryObserver: class { start() {} stop = state.stop; getLatest() { return state.template; } } }));
vi.mock("../../src/browser/page-guard.js", () => ({ waitForTargetPage: vi.fn(), assertTargetPage: vi.fn(), hasMeaningfulFilter: () => true }));
vi.mock("../../src/query/list-collector.js", () => ({ ListCollector: class { collect = state.collect; } }));
vi.mock("../../src/reconnaissance/contract-schema.js", () => ({ loadSiteContract: () => ({
  origin: "https://a8.7x24cc.com", page: { hash: "#/media/chat_record_advanced_query" },
  operations: [{ operation: "conversation-list", method: "POST", pathnamePattern: "^/action$", action: "app.media.queryChatRecord" }]
}) }));

describe("main lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.launch.mockResolvedValue({ pages: () => [{ url: () => "https://a8.7x24cc.com/#/media/chat_record_advanced_query" }] });
    state.update.mockResolvedValue(undefined);
    state.collect.mockRejectedValue(new Error("列表读取失败"));
    state.install.mockImplementation(async start => { await start(); });
  });

  it("导入主入口不会自动启动浏览器", async () => {
    await import("../../src/main.js");
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("列表读取失败显示错误，停止 observer 并禁用已结束的开始按钮", async () => {
    const { main } = await import("../../src/main.js");
    await main();
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("列表读取失败"), running: false, completed: true }));
  });

  it("开始前取消结束等待并停止 observer，不查询列表", async () => {
    state.install.mockImplementation(async (_start, cancel) => { await cancel(); });
    const { main } = await import("../../src/main.js");
    await main();
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.collect).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ running: false, completed: true }));
  });
});
