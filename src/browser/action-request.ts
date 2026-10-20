export interface ActionRequestTemplate {
  method: "POST";
  url: string;
  action: string;
  data: Record<string, unknown>;
  envelope: Record<string, string>;
}

export interface ActionExecutor {
  execute(
    operation: "conversation-list" | "message-detail",
    template: ActionRequestTemplate,
    action: string,
    data: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown>;
}

interface ActionEvaluateArgument {
  url: string;
  envelope: Record<string, string>;
}

interface ActionEvaluateResult {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface ActionPage {
  evaluate(
    pageFunction: (argument: ActionEvaluateArgument) => Promise<ActionEvaluateResult>,
    argument: ActionEvaluateArgument
  ): Promise<ActionEvaluateResult>;
}

export function parseActionRequest(url: string, rawBody: string): ActionRequestTemplate {
  const values = new URLSearchParams(rawBody);
  const envelope = Object.fromEntries(values.entries());
  const action = envelope.action;
  if (!action) throw new Error("未识别到站点动作名");

  let data: unknown;
  try {
    data = JSON.parse(envelope.data ?? "{}");
  } catch {
    throw new Error("站点查询参数无法解析");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("站点查询参数格式无效");
  }

  return {
    method: "POST",
    url,
    action,
    data: data as Record<string, unknown>,
    envelope
  };
}

export class PlaywrightActionExecutor implements ActionExecutor {
  constructor(
    private readonly page: ActionPage,
    private readonly policy: ReadonlyRequestPolicy,
    private readonly onRequestId?: (actionId: string, operation: "conversation-list" | "message-detail") => void
  ) {}

  async execute(
    operation: "conversation-list" | "message-detail",
    template: ActionRequestTemplate,
    action: string,
    data: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
    signal?.throwIfAborted();
    this.policy.assertAllowed({
      method: template.method,
      url: template.url,
      operation,
      action,
      body: data
    });

    if (template.envelope.token && action !== template.action) {
      throw new Error("检测到动作绑定令牌，不能安全复用到另一个只读动作");
    }

    const envelope = {
      ...template.envelope,
      action,
      data: JSON.stringify(data),
      action_id: randomUUID()
    };
    this.onRequestId?.(envelope.action_id, operation);

    const result = await this.page.evaluate(
      async ({ url, envelope: requestEnvelope }) => {
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(new DOMException("只读接口请求 timeout（30秒）", "TimeoutError")), 30000);
        try {
          const response = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: new URLSearchParams(requestEnvelope).toString(),
            signal: timeout.signal
          });
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            body = undefined;
          }
          timeout.signal.throwIfAborted();
          return { status: response.status, ok: response.ok, body };
        } finally {
          clearTimeout(timer);
        }
      },
      { url: template.url, envelope }
    );

    signal?.throwIfAborted();
    if (result.status === 401 || result.status === 403) throw new Error("登录已失效或无权读取会话");
    if (!result.ok) throw new Error(`只读接口请求失败: HTTP ${result.status}`);
    return result.body;
  }
}
import { randomUUID } from "node:crypto";

import type { ReadonlyRequestPolicy } from "../security/request-policy.js";
