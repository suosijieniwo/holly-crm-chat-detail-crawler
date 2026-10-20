import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AppPaths } from "../../src/domain/types.js";
import {
  clearDedicatedLogin,
  clearUnfinishedJobs
} from "../../src/cleanup/local-cleanup.js";

const roots: string[] = [];

async function fixture(): Promise<{ paths: AppPaths; exportedFile: string }> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "customer-chat-exporter-cleanup-"));
  roots.push(tempRoot);
  const appRoot = path.join(tempRoot, "CustomerChatExporter");
  const paths: AppPaths = {
    appRoot,
    profileDir: path.join(appRoot, "edge-profile"),
    jobsDir: path.join(appRoot, "jobs"),
    outputDir: path.join(tempRoot, "Desktop", "客服聊天记录导出")
  };
  await Promise.all([
    mkdir(paths.profileDir, { recursive: true }),
    mkdir(paths.jobsDir, { recursive: true }),
    mkdir(paths.outputDir, { recursive: true })
  ]);
  await writeFile(path.join(paths.profileDir, "login-state.bin"), "fictional-login");
  await writeFile(path.join(paths.jobsDir, "job.json"), "fictional-job");
  const exportedFile = path.join(paths.outputDir, "已导出.xlsx");
  await writeFile(exportedFile, "fictional-workbook");
  return { paths, exportedFile };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("本地敏感数据清理", () => {
  it("清除专用登录状态时保留断点和已导出文件", async () => {
    const { paths, exportedFile } = await fixture();

    const cleared = await clearDedicatedLogin(paths, async () => true);

    expect(cleared).toBe(true);
    await expect(readFile(path.join(paths.profileDir, "login-state.bin"))).rejects.toThrow();
    await expect(readFile(path.join(paths.jobsDir, "job.json"), "utf8")).resolves.toBe("fictional-job");
    await expect(readFile(exportedFile, "utf8")).resolves.toBe("fictional-workbook");
  });

  it("清除未完成任务时保留专用登录状态和已导出文件", async () => {
    const { paths, exportedFile } = await fixture();

    const cleared = await clearUnfinishedJobs(paths, async () => true);

    expect(cleared).toBe(true);
    await expect(readFile(path.join(paths.jobsDir, "job.json"))).rejects.toThrow();
    await expect(readFile(path.join(paths.profileDir, "login-state.bin"), "utf8")).resolves.toBe("fictional-login");
    await expect(readFile(exportedFile, "utf8")).resolves.toBe("fictional-workbook");
  });

  it("用户未确认时不删除任何内容", async () => {
    const { paths } = await fixture();

    const cleared = await clearUnfinishedJobs(paths, async () => false);

    expect(cleared).toBe(false);
    await expect(readFile(path.join(paths.jobsDir, "job.json"), "utf8")).resolves.toBe("fictional-job");
  });

  it("拒绝把应用根目录当作递归删除目标", async () => {
    const { paths } = await fixture();
    const unsafe = { ...paths, jobsDir: paths.appRoot };

    await expect(clearUnfinishedJobs(unsafe, async () => true)).rejects.toThrow("拒绝不安全的清理路径");
  });
});
