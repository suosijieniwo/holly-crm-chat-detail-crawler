import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOutputDirectory, saveOutputDirectory } from "../../src/desktop/output-directory.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "export-directory-"));
  roots.push(root);
  return { root, settings: path.join(root, "local", "desktop-settings.json") };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("desktop output directory preferences", () => {
  it("首次没有默认目录，选择后持久保存并可更换", async () => {
    const { root, settings } = await fixture();
    expect(await loadOutputDirectory(settings)).toBe("");
    const first = path.join(root, "第一次 导出");
    const second = path.join(root, "更换的文件夹");
    await mkdir(first);
    await mkdir(second);
    await saveOutputDirectory(settings, first);
    expect(await loadOutputDirectory(settings)).toBe(first);
    await saveOutputDirectory(settings, second);
    expect(await loadOutputDirectory(settings)).toBe(second);
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({ outputDir: second });
  });

  it("错误目录不能覆盖已保存的有效选择", async () => {
    const { root, settings } = await fixture();
    await saveOutputDirectory(settings, root);
    const file = path.join(root, "不是文件夹.txt");
    await writeFile(file, "sample");
    await expect(saveOutputDirectory(settings, file)).rejects.toThrow();
    await expect(saveOutputDirectory(settings, "relative-path")).rejects.toThrow();
    expect(await loadOutputDirectory(settings)).toBe(root);
  });

  it("损坏或无效设置按首次使用处理", async () => {
    const { settings } = await fixture();
    await mkdir(path.dirname(settings));
    for (const value of ["{bad", "null", '{"outputDir":"relative"}', '{"outputDir":7}']) {
      await writeFile(settings, value);
      expect(await loadOutputDirectory(settings)).toBe("");
    }
  });

  it("运行数据目录不能用作输出，避免清理断点或登录时误删 Excel", async () => {
    const { root, settings } = await fixture();
    await saveOutputDirectory(settings, root);
    const reserved = path.join(path.dirname(settings), "jobs", "excel");
    await mkdir(reserved, { recursive: true });
    await expect(saveOutputDirectory(settings, reserved)).rejects.toThrow(/运行数据/);
    expect(await loadOutputDirectory(settings)).toBe(root);
    await writeFile(settings, JSON.stringify({ outputDir: reserved }));
    expect(await loadOutputDirectory(settings)).toBe("");
  });
});
