/**
 * Runs the full pipeline for an existing job directory without going through
 * the web UI - useful for debugging on demo day. The job must already have
 * data/jobs/<jobId>/input.mp4 (e.g. copied in by hand, or left over from a
 * previous /api/upload call).
 *
 * Usage: npx tsx scripts/render.ts <jobId>
 */
import { loadEnvLocal } from "../lib/loadEnv";
loadEnvLocal();

import { createJob, getJob } from "../lib/jobs";
import { runPipeline } from "../lib/pipeline";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npx tsx scripts/render.ts <jobId>");
    process.exit(1);
  }

  if (!getJob(jobId)) {
    createJob(jobId);
  }

  console.log(`Running pipeline for job ${jobId}…`);
  await runPipeline(jobId);
  console.log(`Done. Final status:`, getJob(jobId));
}

main().catch((err) => {
  console.error("render.ts failed:", err);
  process.exit(1);
});
