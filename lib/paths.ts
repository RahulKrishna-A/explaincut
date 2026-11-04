import path from "node:path";

const JOB_DATA_DIR = process.env.JOB_DATA_DIR ?? "./data/jobs";

export function jobDir(jobId: string): string {
  // Runtime data directory, not source: tell Turbopack not to trace (and bundle) the whole project for it.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), JOB_DATA_DIR, jobId);
}

export function jobFile(jobId: string, filename: string): string {
  return path.join(jobDir(jobId), filename);
}

/** Generated stickers, shared across jobs - the same subject is only ever drawn (and paid for) once. */
export function stickerCacheDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "./data/stickers");
}
