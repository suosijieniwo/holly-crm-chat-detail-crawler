import { readFileSync } from "node:fs";

import { z } from "zod";

import { TARGET_HASH, TARGET_ORIGIN } from "../config/constants.js";
import type { SiteContract } from "../domain/types.js";

const nonEmpty = z.string().trim().min(1);
const jsonPath = nonEmpty;
const selector = nonEmpty;
const pathnamePattern = nonEmpty.refine((value) => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
});
const actionName = nonEmpty.regex(/^[A-Za-z0-9_.:-]+$/);

const operationSchema = z.strictObject({
  operation: z.enum(["conversation-list", "message-detail"]),
  method: z.enum(["GET", "POST"]),
  pathnamePattern,
  action: actionName
});

const pagePaginationSchema = z.strictObject({
  mode: z.literal("page"),
  requestPagePath: jsonPath,
  requestPageSizePath: jsonPath,
  responseHasNextPath: jsonPath.optional(),
  responseNextCursorPath: jsonPath.optional()
});

const cursorPaginationSchema = z.strictObject({
  mode: z.literal("cursor"),
  requestCursorPath: jsonPath,
  responseHasNextPath: jsonPath.optional(),
  responseNextCursorPath: jsonPath
});

const singlePaginationSchema = z.strictObject({
  mode: z.literal("single")
});

const paginationSchema = z.discriminatedUnion("mode", [
  pagePaginationSchema,
  cursorPaginationSchema,
  singlePaginationSchema
]);

const jsonPathRecord = z.record(z.string(), jsonPath).refine(
  (value) => Object.keys(value).length > 0
);

const conversationFieldsSchema = z.strictObject({
  conversationId: jsonPath,
  visitorId: jsonPath.optional(),
  startedAt: jsonPath.optional(),
  endedAt: jsonPath.optional(),
  entry: jsonPath.optional(),
  agent: jsonPath.optional(),
  skillGroup: jsonPath.optional(),
  tags: jsonPath.optional(),
  channel: jsonPath.optional(),
  status: jsonPath.optional(),
  satisfaction: jsonPath.optional()
});

export const SiteContractSchema = z
  .strictObject({
    origin: z.literal(TARGET_ORIGIN),
    page: z.strictObject({
      hash: z.literal(TARGET_HASH),
      requiredTexts: z.array(nonEmpty).min(1),
      queryFormSelector: selector,
      resultTableSelector: selector
    }),
    operations: z.array(operationSchema).min(2),
    list: z.strictObject({
      operation: z.literal("conversation-list"),
      pagination: paginationSchema,
      requestFilterPaths: z.array(jsonPath).min(1),
      requestSortPath: jsonPath.optional(),
      responseRowsPath: jsonPath,
      responseTotalPath: jsonPath,
      fields: conversationFieldsSchema
    }),
    messages: z.strictObject({
      operation: z.literal("message-detail"),
      pagination: paginationSchema,
      requestConversationIdPath: jsonPath,
      responseItemsPath: jsonPath,
      responseDeclaredCountPath: jsonPath.optional(),
      declaredCountComparable: z.boolean(),
      fields: jsonPathRecord,
      supportsCompleteHistory: z.boolean()
    }),
    dom: z.strictObject({
      openConversationSelector: selector,
      messageRowSelector: selector,
      historyStartSelector: selector,
      scrollContainerSelector: selector,
      fields: z.record(z.string(), selector).refine((value) => Object.keys(value).length > 0)
    })
  })
  .superRefine((contract, context) => {
    for (const operation of [contract.list.operation, contract.messages.operation] as const) {
      if (!contract.operations.some((entry) => entry.operation === operation)) {
        context.addIssue({
          code: "custom",
          path: ["operations", operation],
          message: "缺少操作白名单"
        });
      }
    }
  });

export function loadSiteContract(filePath: string): SiteContract {
  let candidate: unknown;
  try {
    candidate = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("siteContract: 无法读取或解析配置文件");
  }

  const result = SiteContractSchema.safeParse(candidate);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path.length === 0 ? "siteContract" : issue.path.map(String).join(".")
        )
      )
    ];
    throw new Error(`siteContract 配置无效: ${fields.join(", ")}`);
  }

  return result.data;
}
