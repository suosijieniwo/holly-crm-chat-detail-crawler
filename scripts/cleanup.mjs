import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanupModule = path.join(root, "dist", "src", "cleanup", "local-cleanup.js");
try {
  await access(cleanupModule);
} catch {
  console.error("缺少清理程序构建文件，请先完成 TypeScript 构建。\n");
  process.exit(1);
}

const [{ resolveAppPaths }, cleanup] = await Promise.all([
  import("../dist/src/config/paths.js"),
  import("../dist/src/cleanup/local-cleanup.js")
]);
const action = process.argv[2];
const operation =
  action === "jobs"
    ? cleanup.clearUnfinishedJobs
    : action === "login"
      ? cleanup.clearDedicatedLogin
      : undefined;
if (!operation) {
  console.error("未知清理动作，仅允许 jobs 或 login。\n");
  process.exit(1);
}

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const completed = await operation(resolveAppPaths(), async (message) => {
    const answer = await terminal.question(`${message}\n输入 YES 确认，其他内容取消：`);
    return answer.trim().toUpperCase() === "YES";
  });
  console.log(completed ? "清理完成。" : "已取消，未删除任何内容。");
} catch (error) {
  console.error(error instanceof Error ? error.message : "清理失败");
  process.exitCode = 1;
} finally {
  terminal.close();
}
