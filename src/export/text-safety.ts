import { EXCEL_TEXT_CHUNK_SIZE } from "../config/constants.js";

export interface SafeExcelText {
  text: string;
  numberFormat: "@";
}

export interface ExcelTextChunk {
  text: string;
  segment: string;
}

export function toSafeExcelText(value: unknown): SafeExcelText {
  return {
    text: value === null || value === undefined ? "" : String(value),
    numberFormat: "@"
  };
}

export function splitExcelText(value: unknown): ExcelTextChunk[] {
  const characters = Array.from(toSafeExcelText(value).text);
  const count = Math.max(1, Math.ceil(characters.length / EXCEL_TEXT_CHUNK_SIZE));
  const chunks: ExcelTextChunk[] = [];
  for (let index = 0; index < count; index += 1) {
    chunks.push({
      text: characters
        .slice(index * EXCEL_TEXT_CHUNK_SIZE, (index + 1) * EXCEL_TEXT_CHUNK_SIZE)
        .join(""),
      segment: `${index + 1}/${count}`
    });
  }
  return chunks;
}
