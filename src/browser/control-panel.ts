import type { Page } from "playwright-core";

export interface PanelActionResult {
  ok: boolean;
  message: string;
}

export interface PanelUpdate {
  title?: string;
  message: string;
  progress?: { completed: number; total: number };
  running?: boolean;
  completed?: boolean;
}

const START_BINDING = "__customerChatExporterStart";
const CANCEL_BINDING = "__customerChatExporterCancel";

export class ControlPanel {
  constructor(private readonly page: Page) {}

  async install(
    onStart: () => Promise<PanelActionResult>,
    onCancel: () => Promise<PanelActionResult>
  ): Promise<void> {
    await this.page.exposeBinding(START_BINDING, () => onStart());
    await this.page.exposeBinding(CANCEL_BINDING, () => onCancel());
    await this.page.evaluate(
      ({ startBinding, cancelBinding }) => {
        document.getElementById("customer-chat-exporter-panel")?.remove();
        const panel = document.createElement("section");
        panel.id = "customer-chat-exporter-panel";
        panel.setAttribute("data-collapsed", "false");
        panel.setAttribute("data-running", "false");
        panel.setAttribute("data-completed", "false");
        panel.innerHTML = `
          <style>
            #customer-chat-exporter-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(300px,calc(100vw - 32px));overflow:hidden;background:rgba(255,255,255,.98);border:1px solid #dce5f2;border-radius:14px;box-shadow:0 10px 30px rgba(23,43,77,.16);font-family:"Microsoft YaHei",sans-serif;color:#25324b;transition:width .18s ease,box-shadow .18s ease}
            #customer-chat-exporter-panel .ce-head{display:flex;align-items:center;gap:9px;min-height:40px;padding:5px 8px 5px 12px;background:linear-gradient(180deg,#fff,#f8fbff);border-bottom:1px solid #edf1f7}
            #customer-chat-exporter-panel .ce-mark{width:8px;height:8px;flex:none;border-radius:50%;background:#1677ff;box-shadow:0 0 0 4px rgba(22,119,255,.1)}
            #customer-chat-exporter-panel h3{flex:1;margin:0;font-size:14px;line-height:1.2;font-weight:700;letter-spacing:.1px}
            #customer-chat-exporter-panel .ce-body{padding:10px 12px 12px}
            #customer-chat-exporter-panel p{margin:0 0 10px;max-height:72px;overflow:auto;line-height:1.5;font-size:12.5px;color:#526079;white-space:pre-wrap}
            #customer-chat-exporter-panel .ce-actions{display:flex;gap:7px}
            #customer-chat-exporter-panel button{border:0;border-radius:8px;min-height:32px;padding:7px 12px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;transition:background .15s ease,opacity .15s ease}
            #customer-chat-exporter-panel .ce-toggle{width:30px;min-height:30px;padding:0;background:transparent;color:#6b7890;font-size:18px;line-height:1}
            #customer-chat-exporter-panel .ce-toggle:hover{background:#edf3fb}
            #customer-chat-exporter-panel .ce-start{background:#1677ff;color:#fff;flex:1;box-shadow:0 3px 8px rgba(22,119,255,.18)}
            #customer-chat-exporter-panel .ce-start:hover{background:#0f6ee8}
            #customer-chat-exporter-panel .ce-cancel{display:none;background:#f1f4f8;color:#5b6678}
            #customer-chat-exporter-panel[data-running="true"] .ce-cancel{display:inline-flex;align-items:center}
            #customer-chat-exporter-panel button:disabled{cursor:not-allowed;opacity:.55}
            #customer-chat-exporter-panel .ce-progress{display:none;height:5px;background:#eaf0f8;border-radius:5px;overflow:hidden;margin:0 0 9px}
            #customer-chat-exporter-panel[data-running="true"] .ce-progress,#customer-chat-exporter-panel[data-completed="true"] .ce-progress{display:block}
            #customer-chat-exporter-panel .ce-progress>i{display:block;width:0;height:100%;background:#1677ff;transition:width .2s}
            #customer-chat-exporter-panel[data-collapsed="true"]{width:168px}
            #customer-chat-exporter-panel[data-collapsed="true"] .ce-head{border-bottom:0}
            #customer-chat-exporter-panel[data-collapsed="true"] .ce-body{display:none}
            @media (max-width:640px){#customer-chat-exporter-panel{right:10px;bottom:10px;width:min(290px,calc(100vw - 20px))}}
          </style>
          <div class="ce-head">
            <span class="ce-mark" aria-hidden="true"></span>
            <h3 id="ce-title">聊天记录导出</h3>
            <button class="ce-toggle" id="ce-toggle" type="button" title="收起" aria-label="收起导出工具">−</button>
          </div>
          <div class="ce-body">
            <p id="ce-message">完成筛选并点击“查询”后，即可导出当前结果。</p>
            <div class="ce-progress"><i id="ce-progress-bar"></i></div>
            <div class="ce-actions"><button class="ce-start" id="ce-start" type="button">开始导出</button><button class="ce-cancel" id="ce-cancel" type="button" disabled>取消</button></div>
          </div>`;
        document.body.appendChild(panel);
        const start = panel.querySelector<HTMLButtonElement>("#ce-start")!;
        const cancel = panel.querySelector<HTMLButtonElement>("#ce-cancel")!;
        const toggle = panel.querySelector<HTMLButtonElement>("#ce-toggle")!;
        const message = panel.querySelector<HTMLElement>("#ce-message")!;
        toggle.addEventListener("click", () => {
          const collapsed = panel.dataset.collapsed === "true";
          panel.dataset.collapsed = String(!collapsed);
          toggle.textContent = collapsed ? "−" : "+";
          toggle.title = collapsed ? "收起" : "展开";
          toggle.setAttribute("aria-label", collapsed ? "收起导出工具" : "展开导出工具");
        });
        start.addEventListener("click", async () => {
          panel.dataset.collapsed = "false";
          panel.dataset.running = "true";
          panel.dataset.completed = "false";
          start.disabled = true;
          message.textContent = "正在检查筛选结果…";
          try {
            const result = await (window as unknown as Record<string, () => Promise<PanelActionResult>>)[startBinding]!();
            message.textContent = result.message;
            panel.dataset.running = String(result.ok);
            if (!result.ok) start.disabled = false;
            else cancel.disabled = false;
          } catch (error) {
            panel.dataset.running = "false";
            start.disabled = false;
            cancel.disabled = true;
            message.textContent = `启动失败：${error instanceof Error ? error.message : "请查看黑色窗口提示后重试"}`;
          }
        });
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          message.textContent = "正在取消导出…";
          try {
            const result = await (window as unknown as Record<string, () => Promise<PanelActionResult>>)[cancelBinding]!();
            message.textContent = result.message;
          } catch (error) {
            message.textContent = `取消失败：${error instanceof Error ? error.message : "请稍后重试"}`;
            cancel.disabled = false;
          }
        });
      },
      { startBinding: START_BINDING, cancelBinding: CANCEL_BINDING }
    );
  }

  async update(update: PanelUpdate): Promise<void> {
    if (this.page.isClosed()) return;
    await this.page.evaluate((value) => {
      const panel = document.getElementById("customer-chat-exporter-panel");
      if (!panel) return;
      const title = panel.querySelector<HTMLElement>("#ce-title");
      const message = panel.querySelector<HTMLElement>("#ce-message");
      const bar = panel.querySelector<HTMLElement>("#ce-progress-bar");
      const start = panel.querySelector<HTMLButtonElement>("#ce-start");
      const cancel = panel.querySelector<HTMLButtonElement>("#ce-cancel");
      if (value.title && title) title.textContent = value.title;
      if (message) message.textContent = value.message;
      if (bar && value.progress) {
        const ratio = value.progress.total === 0 ? 0 : value.progress.completed / value.progress.total;
        bar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
      }
      if (value.running !== undefined) panel.dataset.running = String(value.running);
      if (value.completed !== undefined) panel.dataset.completed = String(value.completed);
      if (value.running) panel.dataset.collapsed = "false";
      if (start) start.disabled = Boolean(value.running || value.completed);
      if (cancel) cancel.disabled = !value.running;
    }, update);
  }
}
