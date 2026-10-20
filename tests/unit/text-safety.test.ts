import { describe, expect, it } from "vitest";

import { splitExcelText, toSafeExcelText } from "../../src/export/text-safety.js";

describe("Excel 文本安全", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tformula", "\rformula"])(
    "将 %s 保留为强制文本",
    (value) => {
      expect(toSafeExcelText(value)).toEqual({ text: value, numberFormat: "@" });
    }
  );

  it("超长中文消息分段后无损还原", () => {
    const source = "测".repeat(64001);
    const chunks = splitExcelText(source);
    expect(chunks.map((item) => item.text).join("")).toBe(source);
    expect(chunks.map((item) => item.segment)).toEqual(["1/3", "2/3", "3/3"]);
  });
});
