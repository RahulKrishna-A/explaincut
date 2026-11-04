import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { JobStage, JobStatus } from "@/types/job";
import { jobDir, jobFile } from "./paths";

// In memory, mirrored to status.json in each job folder. After a server
// restart a job is loaded back from disk on first access, so finished videos
// keep working; one that was mid-pipeline is marked as interrupted.
// Pinned to globalThis: in `next dev` each API route can get its own instance of
// this module, and a module-level Map would then hide a job one route created
// from the others (upload creates it, render can't see it -> "Unknown jobId").
const globalStore = globalThis as typeof globalThis & { __explainCutJobs?: Map<string, JobStatus> };
const jobs = (globalStore.__explainCutJobs ??= new Map<string, JobStatus>());

/** Job ids are server-generated UUIDs (or simple script-made names) - never a path. */
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidJobId(id: unknown): id is string {
  return typeof id === "string" && JOB_ID.test(id);
}

function loadFromDisk(id: string): JobStatus | undefined {
  try {
    const job = JSON.parse(readFileSync(jobFile(id, "status.json"), "utf-8")) as JobStatus;
    if (job.id !== id) return undefined;
    if (job.stage !== "done" && job.stage !== "error") {
      const interrupted: JobStatus = {
        ...job,
        stage: "error",
        error: "Processing was interrupted because the server restarted. Please upload the clip again.",
        updatedAt: Date.now(),
      };
      void persist(interrupted);
      return interrupted;
    }
    return job;
  } catch {
    return undefined;
  }
}

export function createJob(id: string): JobStatus {
  const job: JobStatus = {
    id,
    stage: "uploaded",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stageStartedAt: Date.now(),
    outputReady: false,
  };
  jobs.set(id, job);
  void persist(job);
  return job;
}

export function getJob(id: string): JobStatus | undefined {
  if (!isValidJobId(id)) return undefined;
  let job = jobs.get(id);
  if (!job) {
    job = loadFromDisk(id);
    if (job) jobs.set(id, job);
  }
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Omit<JobStatus, "id" | "createdAt">>
): JobStatus {
  const existing = getJob(id);
  if (!existing) {
    throw new Error(`Unknown job id: ${id}`);
  }
  const now = Date.now();
  const updated: JobStatus = { ...existing, ...patch, updatedAt: now };
  // Book the time spent in the stage we're leaving, so every job carries its own speed profile.
  if (patch.stage && patch.stage !== existing.stage) {
    const started = existing.stageStartedAt ?? existing.createdAt;
    updated.timings = { ...existing.timings, [existing.stage]: (existing.timings?.[existing.stage] ?? 0) + (now - started) };
    updated.stageStartedAt = now;
    if (patch.stage === "done" || patch.stage === "error") {
      const parts = Object.entries(updated.timings).map(([stage, ms]) => `${stage} ${((ms ?? 0) / 1000).toFixed(1)}s`);
      console.info(`Job ${id} ${patch.stage} in ${((now - updated.createdAt) / 1000).toFixed(1)}s: ${parts.join(", ")}`);
    }
  }
  jobs.set(id, updated);
  void persist(updated);
  return updated;
}

export function setJobError(id: string, error: unknown): JobStatus {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Job ${id} failed:`, error);
  return updateJob(id, { stage: "error" as JobStage, error: message });
}

/** Per-job write queue: each status write waits for the previous one, so the newest status always lands last. */
const writeQueue = new Map<string, Promise<void>>();

function persist(job: JobStatus): Promise<void> {
  const next = (writeQueue.get(job.id) ?? Promise.resolve()).then(() => writeStatus(job));
  writeQueue.set(job.id, next);
  void next.then(() => {
    if (writeQueue.get(job.id) === next) writeQueue.delete(job.id);
  });
  return next;
}

async function writeStatus(job: JobStatus): Promise<void> {
  try {
    await fs.mkdir(jobDir(job.id), { recursive: true });
    // Write-then-rename so overlapping persists can't interleave into corrupt JSON.
    const tmp = jobFile(job.id, `status.json.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(job, null, 2));
    await fs.rename(tmp, jobFile(job.id, "status.json"));
  } catch {
    // best-effort only
  }
}
