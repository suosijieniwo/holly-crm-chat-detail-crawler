import ExcelJS from "exceljs";

import type { ConversationResult, JobCheckpoint } from "../domain/types.js";
import { finalizeOutput, removeTemporaryOutput, reserveOutputPath } from "./output-files.js";
import { splitExcelText, toSafeExcelText } from "./text-safety.js";

const SUMMARY_HEADERS = [
  "会话ID",
  "访客ID",
  "访问时间",
  "结束时间",
  "聊天入口",
  "坐席",
  "技能组",
  "会话标签",
  "渠道",
  "状态",
  "满意度",
  "消息总数",
  "页面声明消息数",
  "导出状态"
] as const;

const MESSAGE_HEADERS = [
  "会话ID",
  "消息序号",
  "消息ID",
  "发送时间",
  "发送方类型",
  "发送方名称",
  "消息类型",
  "文字内容",
  "内容完整性",
  "媒体链接",
  "内容分段",
  "采集来源",
  "原始位置",
  "可能重复"
] as const;

function applyHeader(sheet: ExcelJS.Worksheet, headers: readonly string[]): void {
  sheet.addRow([...headers]);
  const row = sheet.getRow(1);
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1677FF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function setText(cell: ExcelJS.Cell, value: unknown): void {
  const safe = toSafeExcelText(value);
  cell.value = safe.text;
  cell.numFmt = safe.numberFormat;
}

function addSafeRow(sheet: ExcelJS.Worksheet, values: unknown[]): ExcelJS.Row {
  const row = sheet.addRow(values.map(() => ""));
  values.forEach((value, index) => setText(row.getCell(index + 1), value));
  row.alignment = { vertical: "top", wrapText: true };
  return row;
}

function statusLabel(status: ConversationResult["status"]): string {
  return status === "success" ? "成功" : status === "partial" ? "部分成功" : "失败";
}

function configureColumns(summary: ExcelJS.Worksheet, messages: ExcelJS.Worksheet): void {
  const summaryWidths = [24, 20, 20, 20, 18, 16, 16, 28, 14, 14, 12, 12, 16, 14];
  summary.columns.forEach((column, index) => (column.width = summaryWidths[index] ?? 16));
  const messageWidths = [24, 10, 24, 20, 12, 18, 14, 72, 14, 48, 10, 12, 18, 12];
  messages.columns.forEach((column, index) => (column.width = messageWidths[index] ?? 16));
}

function validateHeaders(sheet: ExcelJS.Worksheet | undefined, expected: readonly string[]): void {
  if (!sheet) throw new Error("导出文件缺少工作表");
  const actual = sheet.getRow(1).values;
  const cells = Array.isArray(actual) ? actual.slice(1).map(String) : [];
  if (JSON.stringify(cells) !== JSON.stringify(expected)) throw new Error("导出文件表头校验失败");
}

export class WorkbookWriter {
  constructor(
    private readonly outputDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async writeAndFinalize(checkpoint: JobCheckpoint): Promise<string> {
    const finalPath = await reserveOutputPath(this.outputDir, this.now());
    const tempPath = `${finalPath}.tmp.xlsx`;
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "CustomerChatExporter";
      workbook.created = this.now();
      const summarySheet = workbook.addWorksheet("会话汇总");
      const messageSheet = workbook.addWorksheet("消息明细");
      applyHeader(summarySheet, SUMMARY_HEADERS);
      applyHeader(messageSheet, MESSAGE_HEADERS);

      for (const snapshot of [...checkpoint.conversations].sort((a, b) => a.ordinal - b.ordinal)) {
        const result = checkpoint.results[snapshot.conversationId];
        const summary = result?.snapshot.summary ?? snapshot.summary;
        const exportableMessages =
          result?.messages.filter((message) => message.senderType === "visitor" || message.senderType === "agent") ?? [];
        addSafeRow(summarySheet, [
          snapshot.conversationId,
          summary.visitorId,
          summary.startedAt,
          summary.endedAt,
          summary.entry,
          summary.agent,
          summary.skillGroup,
          summary.tags?.join(" / "),
          summary.channel,
          summary.status,
          summary.satisfaction,
          exportableMessages.length,
          result?.declaredMessageCount,
          result ? statusLabel(result.status) : "未完成"
        ]);

        exportableMessages.forEach((message, index) => {
          for (const chunk of splitExcelText(message.visibleText)) {
            addSafeRow(messageSheet, [
              snapshot.conversationId,
              index + 1,
              message.messageId,
              message.sentAt,
              message.senderType,
              message.senderName,
              message.messageType,
              chunk.text,
              message.contentIntegrity,
              message.mediaUrl,
              chunk.segment,
              message.source,
              `${message.position.pageOrCursor}:${message.position.indexInBatch}`,
              message.possibleDuplicate ? "是" : "否"
            ]);
          }
        });
      }

      configureColumns(summarySheet, messageSheet);
      await workbook.xlsx.writeFile(tempPath);

      const verification = await new ExcelJS.Workbook().xlsx.readFile(tempPath);
      if (verification.worksheets.map((sheet) => sheet.name).join("|") !== "会话汇总|消息明细") {
        throw new Error("导出文件工作表校验失败");
      }
      validateHeaders(verification.getWorksheet("会话汇总"), SUMMARY_HEADERS);
      validateHeaders(verification.getWorksheet("消息明细"), MESSAGE_HEADERS);

      await finalizeOutput(tempPath, finalPath);
      return finalPath;
    } catch (error) {
      await removeTemporaryOutput(tempPath);
      throw error;
    }
  }
}
