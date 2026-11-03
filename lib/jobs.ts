import fs from "node:fs/promises";
import type { JobStage, JobStatus } from "@/types/job";
import { jobDir, jobFile } from "./paths";

// In-memory only - fine for a single-user local demo. status.json on disk is
// purely crash insurance, not read back on startup.
const jobs = new Map<string, JobStatus>();

export function createJob(id: string): JobStatus {
  const job: JobStatus = {
    id,
    stage: "uploaded",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    outputReady: false,
  };
  jobs.set(id, job);
  void persist(job);
  return job;
}

export function getJob(id: string): JobStatus | undefined {
  return jobs.get(id);
}

export function updateJob(
  id: string,
  patch: Partial<Omit<JobStatus, "id" | "createdAt">>
): JobStatus {
  const existing = jobs.get(id);
  if (!existing) {
    throw new Error(`Unknown job id: ${id}`);
  }
  const updated: JobStatus = { ...existing, ...patch, updatedAt: Date.now() };
  jobs.set(id, updated);
  void persist(updated);
  return updated;
}

export function setJobError(id: string, error: unknown): JobStatus {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Job ${id} failed:`, error);
  return updateJob(id, { stage: "error" as JobStage, error: message });
}

async function persist(job: JobStatus): Promise<void> {
  try {
    await fs.mkdir(jobDir(job.id), { recursive: true });
    await fs.writeFile(jobFile(job.id, "status.json"), JSON.stringify(job, null, 2));
  } catch {
    // best-effort only
  }
}
