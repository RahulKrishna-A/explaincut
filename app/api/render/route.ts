import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { runPipeline } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  const { jobId } = await request.json();
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Unknown jobId" }, { status: 404 });
  }

  // Fire and forget - the client polls /api/status/[jobId] for progress
  // instead of holding this request open for the whole pipeline.
  void runPipeline(jobId);

  return NextResponse.json({ started: true }, { status: 202 });
}
