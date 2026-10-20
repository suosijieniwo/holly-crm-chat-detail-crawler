import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/browser/control-panel.ts", import.meta.url),
  "utf8"
);

describe("导出控制面板", () => {
  it("提供紧凑且可收起的浮层，避免长期遮挡结果列表", () => {
    expect(source).toContain('id="ce-toggle"');
    expect(source).toContain("data-collapsed");
    expect(source).not.toContain("width:320px");
  });

  it("点击开始后立即显示检查反馈，并处理绑定调用异常", () => {
    expect(source).toContain("正在检查筛选结果");
    expect(source).toMatch(/start\.addEventListener[\s\S]*?try\s*\{/);
    expect(source).toMatch(/start\.addEventListener[\s\S]*?catch(?:\s*\([^)]*\))?\s*\{/);
  });
});
