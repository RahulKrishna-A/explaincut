import path from "node:path";

// Serverless platforms (Vercel, Lambda) have a read-only project directory; /tmp is the only writable place.
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const JOB_DATA_DIR = process.env.JOB_DATA_DIR ?? (SERVERLESS ? "/tmp/explaincut/jobs" : "./data/jobs");

export function jobDir(jobId: string): string {
  // Runtime data directory, not source: tell Turbopack not to trace (and bundle) the whole project for it.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), JOB_DATA_DIR, jobId);
}

export function jobFile(jobId: string, filename: string): string {
  return path.join(jobDir(jobId), filename);
}

/** Generated stickers, shared across jobs - the same subject is only ever drawn (and paid for) once. */
export function stickerCacheDir(): string {
  if (SERVERLESS) return "/tmp/explaincut/stickers";
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "./data/stickers");
}
