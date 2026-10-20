import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { chromium, type BrowserContext, type Response } from "playwright-core";

import { TARGET_HASH, TARGET_ORIGIN } from "../config/constants.js";
import { resolveAppPaths } from "../config/paths.js";

export interface ObservedShape {
  method: string;
  origin: string;
  pathname: string;
  status: number;
  contentType: string;
  requestKeyPaths: string[];
  responseKeyPaths: string[];
  arrayLengths: Record<string, number>;
}

export interface ShapeObservationInput {
  method: string;
  url: string;
  status: number;
  contentType: string;
  requestJson?: unknown;
  responseJson?: unknown;
}

export interface ObservableRequestMetadata {
  method: string;
  url: string;
  resourceType: string;
}

export function shapeOnly(value: unknown, prefix = "$"): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [prefix] : shapeOnly(value[0], `${prefix}[]`);
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      shapeOnly(child, `${prefix}.${key}`)
    );
  }

  return [prefix];
}

function arrayLengthsOnly(value: unknown, prefix = "$", result: Record<string, number> = {}) {
  if (Array.isArray(value)) {
    result[prefix] = value.length;
    if (value.length > 0) arrayLengthsOnly(value[0], `${prefix}[]`, result);
    return result;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      arrayLengthsOnly(child, `${prefix}.${key}`, result);
    }
  }

  return result;
}

export function createObservedShape(input: ShapeObservationInput): ObservedShape {
  const url = new URL(input.url);
  return {
    method: input.method,
    origin: url.origin,
    pathname: url.pathname,
    status: input.status,
    contentType: input.contentType,
    requestKeyPaths: input.requestJson === undefined ? [] : shapeOnly(input.requestJson),
    responseKeyPaths: input.responseJson === undefined ? [] : shapeOnly(input.responseJson),
    arrayLengths: {
      ...(input.requestJson === undefined ? {} : arrayLengthsOnly(input.requestJson)),
      ...(input.responseJson === undefined ? {} : arrayLengthsOnly(input.responseJson))
    }
  };
}

export function shouldObserve(metadata: ObservableRequestMetadata): boolean {
  const method = metadata.method.toUpperCase();
  const url = new URL(metadata.url);
  return (
    url.origin === TARGET_ORIGIN &&
    (method === "GET" || method === "POST") &&
    (metadata.resourceType === "xhr" || metadata.resourceType === "fetch")
  );
}

async function jsonOrUndefined(response: Response, contentType: string): Promise<unknown> {
  if (!contentType.toLowerCase().includes("json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function requestJsonOrUndefined(response: Response): unknown {
  const request = response.request();
  if (request.method() === "GET" || request.postData() === null) return undefined;
  try {
    return request.postDataJSON();
  } catch {
    return undefined;
  }
}

async function observeResponse(response: Response): Promise<ObservedShape | undefined> {
  const request = response.request();
  const method = request.method().toUpperCase();
  if (
    !shouldObserve({ method, url: request.url(), resourceType: request.resourceType() })
  ) {
    return undefined;
  }

  const contentType = (await response.headerValue("content-type")) ?? "";
  return createObservedShape({
    method,
    url: request.url(),
    status: response.status(),
    contentType,
    requestJson: requestJsonOrUndefined(response),
    responseJson: await jsonOrUndefined(response, contentType)
  });
}

async function waitForOperator(
  context: BrowserContext,
  message: string
): Promise<"finished" | "closed"> {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([
      prompt.question(`${message}\n`).then(() => "finished" as const),
      new Promise<"closed">((resolve) => context.once("close", () => resolve("closed")))
    ]);
  } finally {
    prompt.close();
  }
}

export async function captureSession(): Promise<{ outputPath: string; observationCount: number }> {
  const appPaths = resolveAppPaths();
  const discoveryDir = path.win32.join(appPaths.appRoot, "discovery");
  const outputPath = path.win32.join(discoveryDir, "observed-shapes.json");
  mkdirSync(appPaths.profileDir, { recursive: true });
  mkdirSync(discoveryDir, { recursive: true });

  const context = await chromium.launchPersistentContext(appPaths.profileDir, {
    channel: "msedge",
    headless: false
  });
  const observations: ObservedShape[] = [];
  const pending = new Set<Promise<void>>();

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${TARGET_ORIGIN}/${TARGET_HASH}`, { waitUntil: "domcontentloaded" });

    console.log(
      "请在专用 Edge 中手动完成登录并进入媒体会话页。准备好开始人工只读操作后再确认；确认前不会监听网络响应。"
    );
    const ready = await waitForOperator(context, "准备完成后按 Enter 开始只读勘测。");
    if (ready === "finished") {
      context.on("response", (response) => {
        const task = observeResponse(response)
          .then((observation) => {
            if (observation) observations.push(observation);
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      });

      console.log(
        "现在请筛选 3 至 10 个会话并查询，再打开一个短会话和一个长会话。不要修改标签、备注、工单或发送消息。"
      );
      await waitForOperator(context, "完成上述人工只读操作后按 Enter 保存勘测结果。");
      await Promise.allSettled([...pending]);
    }
  } finally {
    if (context.pages().length > 0) await context.close();
  }

  writeFileSync(outputPath, `${JSON.stringify(observations, null, 2)}\n`, "utf8");
  return { outputPath, observationCount: observations.length };
}

async function main(): Promise<void> {
  const result = await captureSession();
  if (result.observationCount === 0) {
    console.error(
      "NEEDS_CONTEXT: 请在专用 Edge 窗口中手动登录目标站点，完成一次只读查询并分别打开一个短会话和一个长会话，然后再次运行 npm run discover。"
    );
    process.exitCode = 2;
    return;
  }
  console.log(`已保存 ${result.observationCount} 条仅含结构的观察记录：${result.outputPath}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
