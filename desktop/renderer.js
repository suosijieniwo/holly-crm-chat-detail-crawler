"use strict";
const byId = id => document.getElementById(id);
const api = window.exporter;
let lastState;

function render(state) {
  lastState = state;
  const running = state.task === "running" || state.task === "stopping";
  const opening = state.browser === "opening" || state.browser === "closing";
  const connected = state.browser === "open";
  byId("connection-label").textContent = state.browser === "closing" ? "正在退出浏览器…" : opening ? "正在连接…" : connected ? "专用浏览器已打开" : "尚未连接后台";
  byId("connection-label").dataset.open = String(connected);
  byId("open-browser").disabled = opening;
  byId("open-browser").querySelector("span").textContent = connected ? "返回后台" : opening ? "正在打开…" : "打开后台";
  byId("browser-hint").textContent = state.queryReady ? "已识别查询，可以开始导出。" : "在专用 Edge 中登录，设置条件并查询。";
  byId("query-summary").textContent = state.querySummary;
  byId("start-export").disabled = !connected || !state.queryReady || running || opening;
  byId("stop-export").disabled = state.task !== "running";
  byId("clear-jobs").disabled = running || opening;
  byId("clear-login").disabled = running || opening || connected;
  byId("task-label").textContent = ({ idle: "等待开始", running: "正在导出", stopping: "正在保存进度", completed: state.complete ? "导出完成" : "已生成，采集未完整", cancelled: "已停止", error: "需要处理" })[state.task];
  byId("task-dot").dataset.tone = state.task === "error" ? "error" : state.task === "completed" && !state.complete ? "warning" : running ? "active" : state.task === "completed" ? "success" : "idle";
  byId("task-message").textContent = state.message;
  const progress = state.progress;
  for (const name of ["completed", "success", "partial", "failed"]) byId(`count-${name}`).textContent = progress ? progress[name].toLocaleString("zh-CN") : "—";
  const ratio = progress?.total ? Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100))) : 0;
  const track = document.querySelector("[role=progressbar]");
  track.dataset.busy = String(running && !progress);
  track.setAttribute("aria-valuenow", String(ratio));
  byId("progress-fill").style.width = `${ratio}%`;
  byId("progress-fraction").textContent = progress ? `${progress.completed.toLocaleString("zh-CN")} / ${progress.total.toLocaleString("zh-CN")} 条会话` : running ? "正在确认会话总量…" : "尚无任务";
  const hasDirectory = Boolean(state.outputDir);
  byId("output-dir").textContent = state.outputDir || "首次导出时选择保存位置，之后自动沿用。";
  byId("output-dir").title = state.outputDir;
  byId("select-output").hidden = hasDirectory;
  byId("select-output").disabled = running || opening;
  byId("change-output").hidden = !hasDirectory;
  byId("change-output").disabled = running || opening;
  byId("open-file").hidden = !hasDirectory;
  byId("open-folder").hidden = !hasDirectory;
  byId("open-file").disabled = !state.output;
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
byId("settings-button").addEventListener("click", () => { byId("settings-feedback").textContent = ""; byId("settings-dialog").showModal(); });
byId("close-settings").addEventListener("click", () => byId("settings-dialog").close());
if (api) {
  api.onState(render);
  api.getState().then(result => { if (result.ok && !lastState) render(result.value); else if (!result.ok) throw new Error(result.error); }).catch(error => { byId("task-message").textContent = `启动失败：${error.message}`; });
} else {
  byId("task-message").textContent = "请通过 exe 启动工具。";
  byId("open-browser").disabled = true;
}
