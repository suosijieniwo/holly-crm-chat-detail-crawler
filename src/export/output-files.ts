import { access, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function reserveOutputPath(outputDir: string, date: Date): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const base = `${timestamp(date)}_客服完整聊天记录`;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? `${base}.xlsx` : `${base}_${suffix}.xlsx`;
    const candidate = path.join(outputDir, name);
    if (!(await exists(candidate)) && !(await exists(`${candidate}.tmp.xlsx`))) return candidate;
  }
}

export async function finalizeOutput(tempPath: string, finalPath: string): Promise<void> {
  if (await exists(finalPath)) throw new Error("导出文件名已被占用，请重新生成");
  await rename(tempPath, finalPath);
}

export async function removeTemporaryOutput(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true });
}
