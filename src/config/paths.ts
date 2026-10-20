import path from "node:path";

import type { AppPaths } from "../domain/types.js";

export function resolveAppPaths(): AppPaths {
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;

  if (!localAppData) {
    throw new Error("缺少环境变量 LOCALAPPDATA，无法确定运行数据目录。");
  }

  if (!userProfile) {
    throw new Error("缺少环境变量 USERPROFILE，无法确定桌面导出目录。");
  }

  const appRoot = path.win32.join(localAppData, "CustomerChatExporter");

  return {
    appRoot,
    profileDir: path.win32.join(appRoot, "edge-profile"),
    jobsDir: path.win32.join(appRoot, "jobs"),
    outputDir: path.win32.join(userProfile, "Desktop", "客服聊天记录导出")
  };
}
