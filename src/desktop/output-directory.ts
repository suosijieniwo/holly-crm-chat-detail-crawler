import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

async function isRuntimeDirectory(settingsFile: string, directory: string): Promise<boolean> {
  const canonical = async (value: string): Promise<string> => {
    try { return await realpath(value); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(value);
      throw error;
    }
  };
  const relative = path.relative(await canonical(path.dirname(settingsFile)), await canonical(directory));
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function loadOutputDirectory(settingsFile: string): Promise<string> {
  try {
    const settings: unknown = JSON.parse(await readFile(settingsFile, "utf8"));
    const directory = settings && typeof settings === "object" ? (settings as Record<string, unknown>).outputDir : undefined;
    return typeof directory === "string" && path.isAbsolute(directory) && !await isRuntimeDirectory(settingsFile, directory) ? directory : "";
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function saveOutputDirectory(settingsFile: string, directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new Error("请选择有效的保存文件夹。");
  await access(directory, constants.W_OK);
  await mkdir(path.dirname(settingsFile), { recursive: true });
  if (await isRuntimeDirectory(settingsFile, directory)) throw new Error("请选择工具运行数据目录以外的保存位置，以免清理任务或登录状态时删除 Excel。");
  const temporary = `${settingsFile}.tmp`;
  await writeFile(temporary, JSON.stringify({ outputDir: directory }), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, settingsFile);
}
