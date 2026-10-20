import { access } from "node:fs/promises";
import path from "node:path";

import { chromium, type BrowserContext } from "playwright-core";

import type { AppPaths } from "../domain/types.js";

async function existing(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续检查下一个标准安装位置。
    }
  }
  return undefined;
}

export async function findEdgeExecutable(): Promise<string | undefined> {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] &&
      path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter((value): value is string => Boolean(value));
  return existing([...new Set(candidates)]);
}

export async function launchDedicatedEdge(paths: AppPaths): Promise<BrowserContext> {
  const executablePath = await findEdgeExecutable();
  if (!executablePath) throw new Error("未找到 Microsoft Edge，请先安装 Edge 后重新启动工具");
  return chromium.launchPersistentContext(paths.profileDir, {
    executablePath,
    headless: false,
    viewport: null,
    args: ["--start-maximized"]
  });
}
