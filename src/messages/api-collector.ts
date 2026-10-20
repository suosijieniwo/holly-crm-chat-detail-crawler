import { createHash } from "node:crypto";

import type { ActionExecutor, ActionRequestTemplate } from "../browser/action-request.js";
import type {
  ConversationSnapshot,
  MessageCollection,
  MessageType,
  RawMessage,
  SenderType,
  SiteContract
} from "../domain/types.js";
import { getJsonPath } from "../utils/json-path.js";

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function senderType(item: unknown, fields: Record<string, string>): SenderType {
  const mode = asString(getJsonPath(item, fields.senderMode ?? "$.Mode"))?.toLowerCase();
  if (mode === "system") return "system";
  if (mode === "receive") return "visitor";
  if (mode === "robot") return "bot";
  if (mode === "reply" || mode === "send") return "agent";
  return "system";
}

function messageType(value: unknown): MessageType {
  const type = String(value ?? "text").toLowerCase();
  if (/(image|picture|pic)/.test(type)) return "image";
  if (/(audio|voice)/.test(type)) return "audio";
  if (/video/.test(type)) return "video";
  if (/(file|attachment)/.test(type)) return "file";
  if (/(card|rich)/.test(type)) return "card";
  if (/system/.test(type)) return "system";
  return "text";
}

function mediaUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
}

function sortValue(item: unknown, fields: Record<string, string>, fallback: number): number {
  const rawTimestamp = getJsonPath(item, fields.timestamp ?? "$.Timestamp");
  const numeric = Number(rawTimestamp);
  if (Number.isFinite(numeric) && numeric !== 0) return numeric;
  const sentAt = asString(getJsonPath(item, fields.sentAt ?? "$.CreateTime"));
  const parsed = sentAt ? Date.parse(sentAt.replace(" ", "T")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class ApiMessageCollector {
  constructor(
    private readonly contract: SiteContract,
    private readonly executor: ActionExecutor,
    private readonly template: ActionRequestTemplate
  ) {}

  async collect(
    conversation: ConversationSnapshot,
    signal?: AbortSignal
  ): Promise<MessageCollection> {
    if (this.contract.messages.pagination.mode !== "single") {
      throw new Error("当前消息契约不是完整单次返回模式");
    }
    const operation = this.contract.operations.find(
      (entry) => entry.operation === this.contract.messages.operation
    );
    if (!operation) throw new Error("缺少消息详情只读动作");

    const data = {
      SequenceID: conversation.conversationId,
      pageSize: 0,
      SystemModeMessageType: { $ne: "DefaultMessage" }
    };
    const response = await this.executor.execute(
      "message-detail",
      this.template,
      operation.action,
      data,
      signal
    );
    if (response === null || typeof response !== "object") throw new Error("消息历史响应格式无效");
    const record = response as Record<string, unknown>;
    if (record.success !== true) throw new Error("消息历史查询失败");
    const items = getJsonPath(record, this.contract.messages.responseItemsPath);
    if (!Array.isArray(items)) throw new Error("消息历史明细格式无效");

    const fields = this.contract.messages.fields;
    const ordered = items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => sortValue(left.item, fields, left.index) - sortValue(right.item, fields, right.index));

    const messages: RawMessage[] = ordered.map(({ item }, index) => {
      const hasContent =
        item !== null &&
        typeof item === "object" &&
        Object.prototype.hasOwnProperty.call(item, (fields.visibleText ?? "$.Content").split(".").at(-1)!);
      const visibleText = asString(getJsonPath(item, fields.visibleText ?? "$.Content")) ?? "";
      const agentName = asString(getJsonPath(item, fields.agentName ?? "$.AgentName"));
      const visitorName = asString(getJsonPath(item, fields.visitorName ?? "$.CusNickName"));
      const robotName = asString(getJsonPath(item, fields.robotName ?? "$.robotName"));
      const rawSequence = Number(getJsonPath(item, fields.serverSequence ?? "$.SerialNumber"));
      const sentAt = asString(getJsonPath(item, fields.sentAt ?? "$.CreateTime"));
      const id = asString(getJsonPath(item, fields.messageId ?? "$.MsgId"));
      const type = senderType(item, fields);
      const mode = asString(getJsonPath(item, fields.senderMode ?? "$.Mode"))?.toLowerCase();
      const knownSender = ["receive", "reply", "send", "robot", "system"].includes(mode ?? "");
      const msgType = messageType(getJsonPath(item, fields.messageType ?? "$.MsgType"));
      const urlField = msgType === "image" ? "PicUrl" : msgType === "audio" ? "VoiceUrl" : msgType === "video" ? "VideoUrl" : undefined;
      const url = (urlField ? mediaUrl(asString(getJsonPath(item, `$.${urlField}`)) ?? "") : undefined) ?? mediaUrl(visibleText);
      const requiresMedia = ["image", "audio", "video", "file"].includes(msgType);
      const stableOverlapKey = createHash("sha256")
        .update(JSON.stringify([id, sentAt, type, visibleText]))
        .digest("hex");

      return {
        messageId: id,
        serverSequence: Number.isFinite(rawSequence) ? rawSequence : undefined,
        sentAt,
        senderType: type,
        senderName: type === "agent" ? agentName : type === "visitor" ? visitorName : robotName,
        messageType: msgType,
        visibleText,
        contentIntegrity: hasContent && knownSender && (!requiresMedia || url) ? "complete" : "incomplete",
        mediaUrl: url,
        source: "api",
        position: { pageOrCursor: "single", indexInBatch: index },
        stableOverlapKey
      };
    });

    return {
      messages,
      reachedHistoryStart: this.contract.messages.supportsCompleteHistory,
      stopReason: this.contract.messages.supportsCompleteHistory ? "explicit-end" : "unknown",
      source: "api"
    };
  }
}
