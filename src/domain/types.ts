export type ExportStatus = "success" | "partial" | "failed";
export type AcquisitionSource = "api" | "dom" | "api+dom";
export type ContentIntegrity = "complete" | "incomplete";
export type SenderType = "visitor" | "agent" | "bot" | "system";
export type MessageType = "text" | "image" | "audio" | "video" | "file" | "card" | "system";

export interface FilterSnapshot {
  canonicalConditions: Record<string, unknown>;
  sort: ReadonlyArray<{ field: string; direction: "asc" | "desc" }>;
  pageSize: number;
  fingerprint: string;
  capturedAt: string;
}

export interface ConversationSummary {
  visitorId?: string;
  startedAt?: string;
  endedAt?: string;
  entry?: string;
  agent?: string;
  skillGroup?: string;
  tags?: string[];
  channel?: string;
  status?: string;
  satisfaction?: string;
}

export interface ConversationSnapshot {
  conversationId: string;
  ordinal: number;
  summary: Readonly<ConversationSummary>;
}

export interface RawMessage {
  messageId?: string;
  serverSequence?: number;
  sentAt?: string;
  senderType: SenderType;
  senderName?: string;
  messageType: MessageType;
  visibleText: string;
  contentIntegrity: ContentIntegrity;
  mediaUrl?: string;
  source: AcquisitionSource;
  position: { pageOrCursor: string; indexInBatch: number };
  stableOverlapKey?: string;
}

export interface MessageCollection {
  messages: RawMessage[];
  declaredMessageCount?: { value: number; comparable: boolean; label?: string };
  reachedHistoryStart: boolean;
  stopReason:
    | "explicit-end"
    | "empty-next-page"
    | "empty-cursor"
    | "cursor-cycle"
    | "duplicate-page"
    | "dom-history-start"
    | "dom-stalled"
    | "page-failed"
    | "unknown";
  source: AcquisitionSource;
}

export interface ConversationResult {
  snapshot: ConversationSnapshot;
  messages: Array<RawMessage & { localKey: string; possibleDuplicate: boolean }>;
  status: ExportStatus;
  reason?: string;
  declaredMessageCount?: number;
  rawUniqueMessageCount: number;
}

export interface JobCheckpoint {
  version: 1;
  senderMappingVersion?: 2;
  jobId: string;
  filter: FilterSnapshot;
  conversations: ConversationSnapshot[];
  completedConversationIds: string[];
  results: Record<string, ConversationResult>;
  createdAt: string;
  updatedAt: string;
}

export interface AppPaths {
  appRoot: string;
  profileDir: string;
  jobsDir: string;
  outputDir: string;
}

export type JsonPath = string;

export interface OperationWhitelistEntry {
  operation: "conversation-list" | "message-detail";
  method: "GET" | "POST";
  pathnamePattern: string;
  action: string;
}

export interface PaginationContract {
  mode: "page" | "cursor" | "single";
  requestPagePath?: JsonPath;
  requestPageSizePath?: JsonPath;
  requestCursorPath?: JsonPath;
  responseHasNextPath?: JsonPath;
  responseNextCursorPath?: JsonPath;
}

export interface SiteContract {
  origin: "https://a8.7x24cc.com";
  page: {
    hash: "#/media/chat_record_advanced_query";
    requiredTexts: string[];
    queryFormSelector: string;
    resultTableSelector: string;
  };
  operations: ReadonlyArray<OperationWhitelistEntry>;
  list: {
    operation: "conversation-list";
    pagination: PaginationContract;
    requestFilterPaths: JsonPath[];
    requestSortPath?: JsonPath;
    responseRowsPath: JsonPath;
    responseTotalPath: JsonPath;
    fields: Partial<Record<keyof ConversationSummary, JsonPath>> & { conversationId: JsonPath };
  };
  messages: {
    operation: "message-detail";
    pagination: PaginationContract;
    requestConversationIdPath: JsonPath;
    responseItemsPath: JsonPath;
    responseDeclaredCountPath?: JsonPath;
    declaredCountComparable: boolean;
    fields: Record<string, JsonPath>;
    supportsCompleteHistory: boolean;
  };
  dom: {
    openConversationSelector: string;
    messageRowSelector: string;
    historyStartSelector: string;
    scrollContainerSelector: string;
    fields: Record<string, string>;
  };
}

export interface MessageCollector {
  collect(conversation: ConversationSnapshot, signal?: AbortSignal): Promise<MessageCollection>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
