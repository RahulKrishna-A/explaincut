import path from "node:path";

const JOB_DATA_DIR = process.env.JOB_DATA_DIR ?? "./data/jobs";

export function jobDir(jobId: string): string {
  return path.resolve(process.cwd(), JOB_DATA_DIR, jobId);
}

export function jobFile(jobId: string, filename: string): string {
  return path.join(jobDir(jobId), filename);
}
