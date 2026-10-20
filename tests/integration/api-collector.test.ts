import { describe, expect, it } from "vitest";

import type { ActionExecutor, ActionRequestTemplate } from "../../src/browser/action-request.js";
import type { ConversationSnapshot, SiteContract } from "../../src/domain/types.js";
import { ApiMessageCollector } from "../../src/messages/api-collector.js";

const template: ActionRequestTemplate = {
  method: "POST",
  url: "https://a8.7x24cc.com/action",
  action: "app.media.queryChatRecord",
  data: { page: 1, limit: 10 },
  envelope: {
    action: "app.media.queryChatRecord",
    data: "{}",
    sessionId: "session-placeholder",
    action_id: "0.1",
    newCurrentMenuId: "#/media/chat_record_advanced_query"
  }
};

const contract = {
  origin: "https://a8.7x24cc.com",
  operations: [
    {
      operation: "conversation-list",
      method: "POST",
      pathnamePattern: "^/action$",
      action: "app.media.queryChatRecord"
    },
    {
      operation: "message-detail",
      method: "POST",
      pathnamePattern: "^/action$",
      action: "app.media.getSessionRecord"
    }
  ],
  messages: {
    operation: "message-detail",
    pagination: { mode: "single" },
    requestConversationIdPath: "$.data.SequenceID",
    responseItemsPath: "$.list",
    declaredCountComparable: false,
    fields: {
      messageId: "$.MsgId",
      sentAt: "$.CreateTime",
      timestamp: "$.Timestamp",
      senderMode: "$.Mode",
      agentName: "$.AgentName",
      visitorName: "$.CusNickName",
      robotName: "$.robotName",
      messageType: "$.MsgType",
      visibleText: "$.Content"
    },
    supportsCompleteHistory: true
  }
} as unknown as SiteContract;

const conversation: ConversationSnapshot = {
  conversationId: "c1",
  ordinal: 1,
  summary: {}
};

describe("ApiMessageCollector", () => {
  it("明确 Mode 优先于机器人上下文且未知模式不猜测人工", async () => {
    const executor: ActionExecutor = {
      async execute() {
        return { success: true, list: ["receive", "reply", "robot", "system", "unknown"].map((Mode, i) => ({
          Mode, Timestamp: i + 1, MsgId: `m${i}`, Content: "脱敏内容",
          robotName: "机器人上下文", AgentName: "坐席上下文"
        })) };
      }
    };
    const result = await new ApiMessageCollector(contract, executor, template).collect(conversation);
    expect(result.messages.map(item => item.senderType)).toEqual(["visitor", "agent", "bot", "system", "system"]);
    expect(result.messages.at(-1)?.contentIntegrity).toBe("incomplete");
  });

  it("保留独立图片、语音、视频链接，缺失媒体链接标记不完整", async () => {
    const executor: ActionExecutor = { async execute() { return { success: true, list: [
      { Mode: "receive", MsgType: "image", Content: "图片", PicUrl: "https://example.com/image.png" },
      { Mode: "reply", MsgType: "voice", Content: "语音", VoiceUrl: "https://example.com/voice.mp3" },
      { Mode: "reply", MsgType: "video", Content: "视频", VideoUrl: "https://example.com/video.mp4" },
      { Mode: "receive", MsgType: "attachment", Content: "附件" }
    ] }; } };
    const result = await new ApiMessageCollector(contract, executor, template).collect(conversation);
    expect(result.messages.map(item => item.mediaUrl)).toEqual(["https://example.com/image.png", "https://example.com/voice.mp3", "https://example.com/video.mp4", undefined]);
    expect(result.messages.map(item => item.contentIntegrity)).toEqual(["complete", "complete", "complete", "incomplete"]);
  });

  it("未核验完整历史的契约不能宣称到达历史起点", async () => {
    const executor: ActionExecutor = { async execute() { return { success: true, list: [] }; } };
    const result = await new ApiMessageCollector({ ...contract, messages: { ...contract.messages, supportsCompleteHistory: false } }, executor, template).collect(conversation);
    expect(result.reachedHistoryStart).toBe(false);
    expect(result.stopReason).toBe("unknown");
  });
  it("以 pageSize=0 一次获取完整历史并恢复为从早到晚", async () => {
    let capturedData: unknown;
    let capturedAction = "";
    const executor: ActionExecutor = {
      async execute(_operation, _template, action, data) {
        capturedAction = action;
        capturedData = data;
        return {
          success: true,
          list: [
            { MsgId: "m2", CreateTime: "2026-08-03 10:01:00", Timestamp: 2, Mode: "send", AgentName: "客服甲", MsgType: "text", Content: "回复" },
            { MsgId: "m1", CreateTime: "2026-08-03 10:00:00", Timestamp: 1, Mode: "receive", CusNickName: "访客甲", robotName: "机器人入口", MsgType: "text", Content: "咨询" }
          ]
        };
      }
    };

    const result = await new ApiMessageCollector(contract, executor, template).collect(conversation);

    expect(capturedAction).toBe("app.media.getSessionRecord");
    expect(capturedData).toEqual({
      SequenceID: "c1",
      pageSize: 0,
      SystemModeMessageType: { $ne: "DefaultMessage" }
    });
    expect(result.messages.map((item) => item.messageId)).toEqual(["m1", "m2"]);
    expect(result.messages.map((item) => item.senderType)).toEqual(["visitor", "agent"]);
    expect(result.reachedHistoryStart).toBe(true);
    expect(result.stopReason).toBe("explicit-end");
  });
});
