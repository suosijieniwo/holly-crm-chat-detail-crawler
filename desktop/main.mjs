import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopController } from "../dist/src/desktop/controller.js";
import { createDesktopRuntime } from "../dist/src/desktop/runtime.js";
import { loadOutputDirectory, saveOutputDirectory } from "../dist/src/desktop/output-directory.js";
import { resolveAppPaths } from "../dist/src/config/paths.js";
import { clearDedicatedLogin, clearUnfinishedJobs } from "../dist/src/cleanup/local-cleanup.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
let window;
export let controller;
let maintenance = false;
let closing = false;
let quitAllowed = false;
app.setName("客服聊天记录导出工具");
app.setAppUserModelId("com.customerchatexporter.desktop");
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on("before-quit", event => { if (!quitAllowed && window && !window.isDestroyed()) { event.preventDefault(); window.close(); } });
  app.on("window-all-closed", () => { quitAllowed = true; app.quit(); });
  void app.whenReady().then(start).catch(error => {
    dialog.showErrorBox("工具启动失败", error instanceof Error ? error.message : String(error));
    quitAllowed = true;
    app.quit();
  });
}

async function start() {
  const paths = resolveAppPaths();
  const settingsFile = path.join(paths.appRoot, "desktop-settings.json");
  paths.outputDir = await loadOutputDirectory(settingsFile);
  const runtime = createDesktopRuntime(path.join(app.getAppPath(), "config", "site-contract.local.json"), paths);
  controller = new DesktopController(runtime, state => {
    if (window && !window.isDestroyed()) window.webContents.send("exporter:state", state);
  });
  window = new BrowserWindow({
    width: 1120, height: 790, minWidth: 820, minHeight: 640,
    title: "客服聊天记录导出工具", backgroundColor: "#f2f6f5", show: false,
    icon: path.join(directory, "assets", "app.ico"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(directory, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const handle = (name, action) => ipcMain.handle(`exporter:${name}`, async event => {
    if (event.sender !== window.webContents) return { ok: false, error: "无效窗口" };
    try { return { ok: true, value: await action() }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  const idle = () => {
    const state = controller.getState();
    if (maintenance || closing || state.task === "running" || state.task === "stopping" || state.browser === "opening" || state.browser === "closing") throw new Error("请先停止任务并等待收尾完成。");
  };
  const confirm = async message => (await dialog.showMessageBox(window, { type: "warning", title: "确认清除", message, buttons: ["取消", "确认清除"], defaultId: 0, cancelId: 0, noLink: true })).response === 1;
  const chooseOutputDirectory = async () => {
    idle();
    maintenance = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "选择 Excel 保存位置", buttonLabel: "保存到此文件夹",
        defaultPath: paths.outputDir || app.getPath("desktop"), properties: ["openDirectory", "createDirectory"]
      });
      const directory = result.filePaths[0];
      if (result.canceled || !directory) return false;
      await saveOutputDirectory(settingsFile, directory);
      controller.setOutputDirectory(directory);
      return true;
    } finally { maintenance = false; }
  };
  const clean = async kind => {
    idle();
    if (kind === "login" && controller.getState().browser !== "closed") throw new Error("请先关闭工具的专用 Edge，再清除登录状态。");
    maintenance = true;
    try {
      if (kind === "login") await runtime.closeBrowser();
      return await (kind === "login" ? clearDedicatedLogin : clearUnfinishedJobs)(paths, confirm);
    }
    finally { maintenance = false; }
  };
  handle("getState", () => controller.getState());
  handle("openBrowser", () => { if (maintenance || closing) throw new Error("工具正在清理或关闭，请稍候。"); return controller.openBrowser(); });
  handle("startExport", async () => {
    if (maintenance || closing) throw new Error("工具正在处理其他操作，请稍候。");
    if (!paths.outputDir && !await chooseOutputDirectory()) return false;
    return controller.startExport();
  });
  handle("stopExport", () => controller.stopExport());
  handle("selectOutputDirectory", chooseOutputDirectory);
  handle("openOutputFolder", async () => {
    if (!paths.outputDir) throw new Error("请先选择 Excel 保存位置。");
    await mkdir(paths.outputDir, { recursive: true });
    const error = await shell.openPath(paths.outputDir);
    if (error) throw new Error(error);
  });
  handle("openLatestFile", async () => {
    const file = controller.getState().output;
    if (!file) throw new Error("尚未生成 Excel。");
    try { await access(file); } catch { throw new Error("文件已移动或删除，请到导出文件夹查找。"); }
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
  });
  handle("clearJobs", () => clean("jobs"));
  handle("clearLogin", () => clean("login"));
  window.on("close", event => {
    if (quitAllowed) return;
    event.preventDefault();
    if (closing || maintenance) return;
    closing = true;
    void (async () => {
      const state = controller.getState();
      if (state.task === "running" || state.task === "stopping") {
        const answer = await dialog.showMessageBox(window, { type: "question", title: "停止并退出", message: "正在导出。要保存已有进度后退出吗？", buttons: ["继续导出", "停止并退出"], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) return;
      }
      try { await controller.close(); }
      catch (error) {
        if (!controller.getState().saveFailed) throw error;
        const answer = await dialog.showMessageBox(window, { type: "warning", title: "进度尚未保存", message: error instanceof Error ? error.message : String(error), detail: "最近一次进度未能写入磁盘。仍然退出可能丢失该次未保存的进度；此前已保存的断点会保留。", buttons: ["返回处理", "仍然退出"], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) return;
        await controller.close(true);
      }
      quitAllowed = true;
      window.destroy();
    })().catch(error => { dialog.showErrorBox("退出未完成", error instanceof Error ? error.message : String(error)); }).finally(() => { closing = false; });
  });
  window.once("ready-to-show", () => window.show());
  await window.loadFile(path.join(directory, "index.html"));
}
