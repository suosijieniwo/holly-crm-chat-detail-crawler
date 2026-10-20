import { rm } from "node:fs/promises";
import path from "node:path";

import type { AppPaths } from "../domain/types.js";

export type CleanupConfirmation = (message: string) => Promise<boolean>;

function assertSafeTarget(appRootValue: string, targetValue: string): string {
  if (!path.isAbsolute(appRootValue) || !path.isAbsolute(targetValue)) {
    throw new Error("拒绝不安全的清理路径：必须使用绝对路径");
  }
  const appRoot = path.resolve(appRootValue);
  const target = path.resolve(targetValue);
  if (path.basename(appRoot).toLowerCase() !== "customerchatexporter") {
    throw new Error("拒绝不安全的清理路径：应用目录名称不匹配");
  }
  if (target === appRoot || !target.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("拒绝不安全的清理路径：目标不在应用专用目录内");
  }
  return target;
}

async function clearTarget(
  appRoot: string,
  target: string,
  confirmation: CleanupConfirmation,
  message: string
): Promise<boolean> {
  const safeTarget = assertSafeTarget(appRoot, target);
  if (!(await confirmation(message))) return false;
  await rm(safeTarget, { recursive: true, force: true });
  return true;
}

export function clearUnfinishedJobs(
  paths: AppPaths,
  confirmation: CleanupConfirmation
): Promise<boolean> {
  return clearTarget(
    paths.appRoot,
    paths.jobsDir,
    confirmation,
    "确认清除聊天记录导出工具的未完成任务断点？已导出的 Excel 和专用登录状态会保留。"
  );
}

export function clearDedicatedLogin(
  paths: AppPaths,
  confirmation: CleanupConfirmation
): Promise<boolean> {
  return clearTarget(
    paths.appRoot,
    paths.profileDir,
    confirmation,
    "确认清除聊天记录导出工具的专用登录状态？未完成任务断点和已导出的 Excel 会保留。"
  );
}
