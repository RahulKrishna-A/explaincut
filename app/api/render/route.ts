import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/jobs";
import { runPipeline } from "@/lib/pipeline";
import { parseRenderOptions } from "@/lib/renderOptions";

export async function POST(request: NextRequest) {
  const { jobId, options } = await request.json();
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Unknown jobId" }, { status: 404 });
  }
  updateJob(jobId, { options: parseRenderOptions(options) });

  // Fire and forget - the client polls /api/status/[jobId] for progress
  // instead of holding this request open for the whole pipeline.
  void runPipeline(jobId);

  return NextResponse.json({ started: true }, { status: 202 });
}
