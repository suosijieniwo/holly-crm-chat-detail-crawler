import { createHash } from "node:crypto";

import type { FilterSnapshot } from "../domain/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function createFilterSnapshot(
  queryData: Record<string, unknown>,
  capturedAt = new Date().toISOString()
): FilterSnapshot {
  const { page: _page, limit, ...conditions } = queryData;
  const pageSize = Number(limit);
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error("当前查询每页数量无效");

  const canonicalConditions = canonicalize(conditions) as Record<string, unknown>;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ canonicalConditions, pageSize, sort: [] }))
    .digest("hex");

  return {
    canonicalConditions,
    sort: [],
    pageSize,
    fingerprint,
    capturedAt
  };
}
