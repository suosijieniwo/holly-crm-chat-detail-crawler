import type { SiteContract } from "../domain/types.js";

export interface ReadonlyRequest {
  method: string;
  url: string;
  operation: "conversation-list" | "message-detail";
  action: string;
  body?: unknown;
}

export class ReadonlyRequestPolicy {
  constructor(private readonly contract: Pick<SiteContract, "origin" | "operations">) {}

  assertAllowed(request: ReadonlyRequest): void {
    const url = new URL(request.url);
    if (url.origin !== this.contract.origin) {
      throw new Error("禁止跨域请求");
    }

    if (request.method !== "GET" && request.method !== "POST") {
      throw new Error("禁止写操作");
    }

    const allowed = this.contract.operations.find(
      (entry) =>
        entry.operation === request.operation &&
        entry.method === request.method &&
        entry.action === request.action &&
        new RegExp(entry.pathnamePattern).test(url.pathname)
    );

    if (!allowed) {
      throw new Error("请求不在只读白名单");
    }
  }
}
