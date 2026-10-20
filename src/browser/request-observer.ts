import { parseActionRequest, type ActionRequestTemplate } from "./action-request.js";

export interface RequestLike {
  method(): string;
  url(): string;
  postData(): string | null;
}

export interface ResponseLike {
  status(): number;
  request(): RequestLike;
  json(): Promise<unknown>;
}

export interface ResponseEventSource {
  on(event: "response", handler: (response: ResponseLike) => void): void;
  off(event: "response", handler: (response: ResponseLike) => void): void;
}

export interface ListQuerySignature {
  origin: string;
  path: string;
  action: string;
}

export class ListQueryObserver {
  private latest?: ActionRequestTemplate;
  private started = false;

  private readonly handler = (response: ResponseLike): void => {
    void this.observe(response);
  };

  constructor(
    private readonly source: ResponseEventSource,
    private readonly signature: ListQuerySignature,
    private readonly onQuery?: (template: ActionRequestTemplate) => void,
    private readonly ignoreQuery?: (template: ActionRequestTemplate) => boolean
  ) {}

  start(): void {
    if (this.started) return;
    this.source.on("response", this.handler);
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    this.source.off("response", this.handler);
    this.started = false;
  }

  getLatest(): ActionRequestTemplate | undefined {
    return this.latest
      ? {
          ...this.latest,
          data: structuredClone(this.latest.data),
          envelope: { ...this.latest.envelope }
        }
      : undefined;
  }

  private async observe(response: ResponseLike): Promise<void> {
    try {
      const request = response.request();
      if (request.method() !== "POST" || response.status() !== 200) return;
      const url = new URL(request.url());
      if (url.origin !== this.signature.origin || url.pathname !== this.signature.path) return;
      const rawBody = request.postData();
      if (!rawBody) return;
      const template = parseActionRequest(request.url(), rawBody);
      if (template.action !== this.signature.action) return;
      if (this.ignoreQuery?.(template)) return;
      const body = await response.json();
      if (!this.started) return;
      if (body === null || typeof body !== "object") return;
      if ((body as Record<string, unknown>).success !== true) return;
      this.latest = template;
      this.onQuery?.(this.getLatest()!);
    } catch {
      // 被动观察失败不应中断网页操作，也不记录请求值或响应值。
    }
  }
}
