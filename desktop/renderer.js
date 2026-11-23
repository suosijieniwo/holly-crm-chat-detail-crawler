"use strict";
const byId = id => document.getElementById(id);
const api = window.exporter;
let lastState;

function render(state) {
  lastState = state;
  const running = state.task === "running" || state.task === "stopping";
  const opening = state.browser === "opening" || state.browser === "closing";
  const connected = state.browser === "open";
  const browserButton = byId("open-browser");
  const needsQuery = !state.queryReady && !running;
  browserButton.disabled = opening;
  browserButton.classList.toggle("primary", needsQuery);
  browserButton.classList.toggle("secondary", !needsQuery);
  browserButton.querySelector("span").textContent = {
    closed: "打开后台", opening: "正在打开…", open: "返回后台", closing: "正在关闭…"
  }[state.browser];
  byId("query-summary").textContent = state.queryReady || running
    ? state.querySummary
    : connected ? "设置筛选条件后，在后台点击「查询」。" : "在专用 Edge 中登录并查询。";
  const senderSelection = state.senderSelection || ["visitor", "agent"];
  for (const input of document.querySelectorAll("[data-sender]")) {
    input.checked = senderSelection.includes(input.value);
    input.disabled = running || opening;
  }
  byId("start-export").disabled = !connected || !state.queryReady || !senderSelection.length || running || opening;
  byId("stop-export").hidden = !running;
  byId("stop-export").disabled = state.task !== "running";
  byId("clear-jobs").disabled = running || opening;
  byId("clear-login").disabled = running || opening || connected;
  byId("progress-heading").hidden = state.task === "idle";
  const label = {
    idle: "", running: "正在导出", stopping: "正在保存进度", completed: state.complete ? "导出完成" : "已导出，部分会话未完整",
    cancelled: "已停止", error: "导出中断"
  }[state.task];
  if (byId("task-label").textContent !== label) byId("task-label").textContent = label;
  byId("task-dot").dataset.tone = state.task === "error" ? "error" : state.task === "completed" && !state.complete ? "warning" : running ? "active" : state.task === "completed" ? "success" : "idle";
  const progress = state.progress;
  const message = state.task === "completed" && !state.complete
    ? "用相同筛选重新导出，可重试未完成的会话。"
    : state.task === "error" || state.task === "cancelled" || (state.task === "running" && !progress) ? state.message : "";
  const taskMessage = byId("task-message");
  taskMessage.dataset.tone = state.task === "error" ? "error" : "";
  if (taskMessage.textContent !== message) taskMessage.textContent = message;
  byId("progress-details").hidden = !progress;
  for (const name of ["success", "partial", "failed"]) byId(`count-${name}`).textContent = progress ? progress[name].toLocaleString("zh-CN") : "—";
  const ratio = progress?.total ? Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100))) : 0;
  const track = document.querySelector("[role=progressbar]");
  track.setAttribute("aria-valuenow", String(ratio));
  byId("progress-fill").style.width = `${ratio}%`;
  const fraction = progress ? `${progress.completed.toLocaleString("zh-CN")} / ${progress.total.toLocaleString("zh-CN")} 条会话` : "";
  track.setAttribute("aria-valuetext", fraction);
  byId("progress-fraction").textContent = fraction;
  const hasDirectory = Boolean(state.outputDir);
  byId("output-dir").hidden = !hasDirectory || Boolean(state.output);
  byId("output-dir").textContent = state.outputDir;
  byId("select-output").hidden = hasDirectory;
  byId("select-output").disabled = running || opening;
  byId("change-output").hidden = !hasDirectory;
  byId("change-output").disabled = running || opening;
  byId("open-file").hidden = !state.output;
  byId("open-folder").hidden = !hasDirectory;
  byId("result-label").textContent = state.output ? "本次导出文件" : "Excel 保存位置";
  byId("result-path").hidden = !state.output;
  byId("result-path").textContent = state.output || "";
  byId("action-feedback").textContent = "";
}

async function act(name, feedback = "action-feedback") {
  byId(feedback).textContent = "";
  try {
    const result = await api[name]();
    if (!result.ok) throw new Error(result.error);
    if (name === "clearJobs" || name === "clearLogin") byId(feedback).textContent = result.value ? "已清除。已导出的 Excel 保持原样。" : "已取消。";
  } catch (error) {
    byId(feedback).textContent = error instanceof Error ? error.message : String(error);
  }
}
for (const [id, action] of Object.entries({ "open-browser": "openBrowser", "start-export": "startExport", "stop-export": "stopExport", "select-output": "selectOutputDirectory", "change-output": "selectOutputDirectory", "open-folder": "openOutputFolder", "open-file": "openLatestFile" })) byId(id).addEventListener("click", () => { void act(action); });
for (const [id, action] of Object.entries({ "clear-jobs": "clearJobs", "clear-login": "clearLogin" })) byId(id).addEventListener("click", () => { void act(action, "settings-feedback"); });
async function saveSenderSelection() {
  const selection = [...document.querySelectorAll("[data-sender]")].filter(input => input.checked).map(input => input.value);
  if (!selection.length) {
    render(lastState);
    byId("action-feedback").textContent = "至少选择一种聊天内容。";
    return;
  }
  byId("action-feedback").textContent = "";
  try {
    const result = await api.setSenderSelection(selection);
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    render(lastState);
    byId("action-feedback").textContent = error instanceof Error ? error.message : String(error);
  }
}
for (const input of document.querySelectorAll("[data-sender]")) input.addEventListener("change", () => { void saveSenderSelection(); });
const settingsDialog = byId("settings-dialog");
let settingsActive = false;
async function setSettingsOpen(open) {
  const result = await api.setSettingsOpen(open);
  if (!result.ok) throw new Error(result.error);
}
byId("settings-button").addEventListener("click", async () => {
  if (settingsActive) return;
  settingsActive = true;
  byId("action-feedback").textContent = "";
  try {
    await setSettingsOpen(true);
    byId("settings-feedback").textContent = "";
    settingsDialog.showModal();
  } catch (error) {
    await setSettingsOpen(false).catch(() => {});
    settingsActive = false;
    byId("action-feedback").textContent = error instanceof Error ? error.message : String(error);
  }
});
byId("close-settings").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("close", async () => {
  try { await setSettingsOpen(false); }
  catch (error) { byId("action-feedback").textContent = error instanceof Error ? error.message : String(error); }
  finally { settingsActive = false; }
});
if (api) {
  api.onState(render);
  api.getState().then(result => { if (result.ok && !lastState) render(result.value); else if (!result.ok) throw new Error(result.error); }).catch(error => { byId("task-message").textContent = `启动失败：${error.message}`; });
} else {
  byId("task-message").textContent = "请通过 exe 启动工具。";
  byId("open-browser").disabled = true;
}
