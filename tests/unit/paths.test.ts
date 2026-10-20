import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppPaths } from "../../src/config/paths.js";

describe("resolveAppPaths", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("将敏感运行数据放在 LOCALAPPDATA，最终文件放在桌面", () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\tester\\AppData\\Local");
    vi.stubEnv("USERPROFILE", "C:\\Users\\tester");
    expect(resolveAppPaths()).toEqual({
      appRoot: "C:\\Users\\tester\\AppData\\Local\\CustomerChatExporter",
      profileDir: "C:\\Users\\tester\\AppData\\Local\\CustomerChatExporter\\edge-profile",
      jobsDir: "C:\\Users\\tester\\AppData\\Local\\CustomerChatExporter\\jobs",
      outputDir: "C:\\Users\\tester\\Desktop\\客服聊天记录导出"
    });
  });
});
