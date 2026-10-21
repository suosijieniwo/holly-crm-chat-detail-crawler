import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EXPORT_SENDER_SELECTION, parseExportSenderSelection, requireExportSenderSelection, type ExportSenderType } from "../domain/export-senders.js";

async function readSettings(settingsFile: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(settingsFile, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeSettings(settingsFile: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.tmp`;
  await writeFile(temporary, JSON.stringify(settings), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, settingsFile);
}

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
  const settings = await readSettings(settingsFile);
  const directory = settings.outputDir;
  return typeof directory === "string" && path.isAbsolute(directory) && !await isRuntimeDirectory(settingsFile, directory) ? directory : "";
}

export async function loadExportSenderSelection(settingsFile: string): Promise<ExportSenderType[]> {
  const settings = await readSettings(settingsFile);
  return parseExportSenderSelection(settings.senderSelection) ?? [...DEFAULT_EXPORT_SENDER_SELECTION];
}

export async function saveExportSenderSelection(settingsFile: string, value: unknown): Promise<void> {
  const selection = requireExportSenderSelection(value);
  const settings = await readSettings(settingsFile);
  await writeSettings(settingsFile, { ...settings, senderSelection: selection });
}

export async function saveOutputDirectory(settingsFile: string, directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new Error("请选择有效的保存文件夹。");
  await access(directory, constants.W_OK);
  if (await isRuntimeDirectory(settingsFile, directory)) throw new Error("请选择工具运行数据目录以外的保存位置，以免清理任务或登录状态时删除 Excel。");
  const settings = await readSettings(settingsFile);
  await writeSettings(settingsFile, { ...settings, outputDir: directory });
}
