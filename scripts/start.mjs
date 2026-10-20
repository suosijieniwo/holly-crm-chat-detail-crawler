import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ["主程序构建文件", path.join(root, "dist", "src", "main.js")],
  ["站点只读契约", path.join(root, "config", "site-contract.local.json")],
  ["Playwright 依赖", path.join(root, "node_modules", "playwright-core", "package.json")],
  ["ExcelJS 依赖", path.join(root, "node_modules", "exceljs", "package.json")]
];

if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("需要 Node.js 24 或更高版本。请升级后重新双击启动。");
  process.exit(1);
}

for (const [label, file] of required) {
  try {
    await access(file);
  } catch {
    console.error(`缺少${label}：${file}`);
    console.error("请保留完整工具文件夹，或先在工具目录完成构建。");
    process.exit(1);
  }
}

const child = spawn(process.execPath, [path.join(root, "dist", "src", "main.js")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: false
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`启动失败：${error.message}`);
  process.exit(1);
});
