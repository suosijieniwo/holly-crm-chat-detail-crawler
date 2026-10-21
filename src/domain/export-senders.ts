export const EXPORT_SENDER_TYPES = ["visitor", "agent", "bot"] as const;
export type ExportSenderType = (typeof EXPORT_SENDER_TYPES)[number];
export const DEFAULT_EXPORT_SENDER_SELECTION: ExportSenderType[] = ["visitor", "agent"];

export function parseExportSenderSelection(value: unknown): ExportSenderType[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.some(item => !EXPORT_SENDER_TYPES.includes(item as ExportSenderType))) return undefined;
  const selected = new Set(value as ExportSenderType[]);
  if (selected.size !== value.length) return undefined;
  return EXPORT_SENDER_TYPES.filter(item => selected.has(item));
}

export function requireExportSenderSelection(value: unknown): ExportSenderType[] {
  const selection = parseExportSenderSelection(value);
  if (!selection) {
    throw new Error(Array.isArray(value) && value.length === 0 ? "至少选择一种聊天内容。" : "导出内容选择无效。");
  }
  return selection;
}
