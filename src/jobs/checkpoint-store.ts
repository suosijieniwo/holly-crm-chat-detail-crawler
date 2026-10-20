import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JobCheckpoint } from "../domain/types.js";

function safeJobId(jobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(jobId)) throw new Error("任务ID格式无效");
  return jobId;
}

function isCheckpoint(value: unknown): value is JobCheckpoint {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.jobId === "string" &&
    record.filter !== null &&
    typeof record.filter === "object" &&
    typeof (record.filter as Record<string, unknown>).fingerprint === "string" &&
    Array.isArray(record.conversations) &&
    Array.isArray(record.completedConversationIds) &&
    record.results !== null &&
    typeof record.results === "object"
  );
}

export interface JobStore {
  save(checkpoint: JobCheckpoint): Promise<void>;
  loadResumable(fingerprint: string): Promise<JobCheckpoint | undefined>;
  remove(jobId: string): Promise<void>;
}

export class FileJobStore implements JobStore {
  constructor(private readonly jobsDir: string) {}

  async save(checkpoint: JobCheckpoint): Promise<void> {
    const jobId = safeJobId(checkpoint.jobId);
    await mkdir(this.jobsDir, { recursive: true });
    const finalPath = path.join(this.jobsDir, `${jobId}.json`);
    const tempPath = path.join(this.jobsDir, `${jobId}.tmp.json`);
    await writeFile(tempPath, JSON.stringify(checkpoint), { encoding: "utf8", mode: 0o600 });
    const handle = await open(tempPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, finalPath);
  }

  async loadResumable(fingerprint: string): Promise<JobCheckpoint | undefined> {
    let files: string[];
    try {
      files = (await readdir(this.jobsDir)).filter((file) => file.endsWith(".json"));
    } catch {
      return undefined;
    }
    const matches: JobCheckpoint[] = [];
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(this.jobsDir, file), "utf8"));
        if (isCheckpoint(parsed) && parsed.filter.fingerprint === fingerprint) matches.push(parsed);
      } catch {
        // 损坏或未完成的临时文件不会中断其他任务恢复。
      }
    }
    return matches.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async remove(jobId: string): Promise<void> {
    const safe = safeJobId(jobId);
    await rm(path.join(this.jobsDir, `${safe}.json`), { force: true });
    await rm(path.join(this.jobsDir, `${safe}.tmp.json`), { force: true });
  }
}
