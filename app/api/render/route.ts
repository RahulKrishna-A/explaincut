import { NextRequest, NextResponse, after } from "next/server";
import { getJob, updateJob } from "@/lib/jobs";
import { runPipeline } from "@/lib/pipeline";
import { parseRenderOptions } from "@/lib/renderOptions";

/**
 * The pipeline runs after this response, inside the same invocation. On a
 * self-hosted server this is unlimited; on a serverless platform it is capped
 * by this value (Vercel Pro/Enterprise allow up to 800 s).
 */
export const maxDuration = 800;

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown; options?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const job = typeof body.jobId === "string" ? getJob(body.jobId) : undefined;
  if (!job) {
    return NextResponse.json({ error: "Unknown jobId" }, { status: 404 });
  }
  // A job runs once - a double click or a retried request must not start a second pipeline on the same files.
  if (job.stage !== "uploaded") {
    return NextResponse.json({ error: "This job has already started" }, { status: 409 });
  }
  updateJob(job.id, { stage: "transcribing", options: parseRenderOptions(body.options) });

  // Runs after the response is sent - the client polls /api/status/[jobId]
  // for progress instead of holding this request open for the whole pipeline.
  // after() (not a bare promise) keeps serverless platforms from freezing it.
  after(() => runPipeline(job.id));

  return NextResponse.json({ started: true }, { status: 202 });
}
