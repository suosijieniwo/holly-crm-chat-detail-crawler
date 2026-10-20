function segments(path: string): string[] {
  if (!path.startsWith("$.")) throw new Error(`不支持的 JSON path: ${path}`);
  return path.slice(2).split(".").filter(Boolean);
}

export function getJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of segments(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setJsonPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = segments(path);
  if (parts.length === 0) throw new Error(`不支持的 JSON path: ${path}`);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}
