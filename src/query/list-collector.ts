import type { ActionExecutor, ActionRequestTemplate } from "../browser/action-request.js";
import type {
  ConversationSnapshot,
  ConversationSummary,
  FilterSnapshot,
  SiteContract
} from "../domain/types.js";
import { getJsonPath } from "../utils/json-path.js";
import { createFilterSnapshot } from "./filter-snapshot.js";

export interface ListCollectionResult {
  filter: FilterSnapshot;
  conversations: ConversationSnapshot[];
  reportedTotal: number;
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

export class ListCollector {
  constructor(
    private readonly contract: SiteContract,
    private readonly executor: ActionExecutor
  ) {}

  async collect(
    template: ActionRequestTemplate,
    capturedAt?: string,
    signal?: AbortSignal
  ): Promise<ListCollectionResult> {
    if (this.contract.list.pagination.mode !== "page") {
      throw new Error("会话列表分页契约不是页码模式");
    }
    const operation = this.contract.operations.find(
      (entry) => entry.operation === this.contract.list.operation
    );
    if (!operation) throw new Error("缺少会话列表只读动作");
    if (template.action !== operation.action) throw new Error("当前查询动作与白名单不一致");

    const filter = createFilterSnapshot(template.data, capturedAt);
    const unique = new Map<string, ConversationSnapshot>();
    let reportedTotal: number | undefined;
    let page = 1;

    while (true) {
      const data = { ...template.data, page, limit: filter.pageSize };
      const response = await this.executor.execute(
        "conversation-list",
        template,
        operation.action,
        data,
        signal
      );
      if (response === null || typeof response !== "object") throw new Error("会话列表响应格式无效");
      const record = response as Record<string, unknown>;
      if (record.success !== true) throw new Error("会话列表查询失败");

      const total = Number(getJsonPath(record, this.contract.list.responseTotalPath));
      if (!Number.isInteger(total) || total < 0) throw new Error("无法确认会话查询总量");
      if (reportedTotal === undefined) {
        reportedTotal = total;
      }

      const rows = getJsonPath(record, this.contract.list.responseRowsPath);
      if (!Array.isArray(rows)) throw new Error("会话列表明细格式无效");

      const uniqueCountBeforePage = unique.size;
      for (const row of rows) {
        if (row === null || typeof row !== "object") continue;
        const idValue = getJsonPath(row, this.contract.list.fields.conversationId);
        if (idValue === null || idValue === undefined || idValue === "") continue;
        const conversationId = String(idValue);
        if (unique.has(conversationId)) continue;

        const summary: ConversationSummary = {};
        for (const key of [
          "visitorId",
          "startedAt",
          "endedAt",
          "entry",
          "agent",
          "skillGroup",
          "channel",
          "status",
          "satisfaction"
        ] as const) {
          const path = this.contract.list.fields[key];
          if (!path) continue;
          const value = optionalText(getJsonPath(row, path));
          if (value !== undefined) summary[key] = value;
        }
        const tagsPath = this.contract.list.fields.tags;
        if (tagsPath) {
          const tags = getJsonPath(row, tagsPath);
          if (Array.isArray(tags)) summary.tags = tags.map(String);
        }

        unique.set(conversationId, {
          conversationId,
          ordinal: unique.size + 1,
          summary
        });
      }

      const pageAddedNoNewConversations = unique.size === uniqueCountBeforePage;
      if (
        rows.length === 0 ||
        rows.length < filter.pageSize ||
        pageAddedNoNewConversations
      ) {
        break;
      }
      page += 1;
    }

    return {
      filter,
      conversations: [...unique.values()],
      reportedTotal: reportedTotal ?? 0
    };
  }
}
