import { NextRequest, NextResponse } from "next/server";
import { jobFile } from "@/lib/paths";
import { getJob } from "@/lib/jobs";
import { serveFile } from "@/lib/http/serveFile";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job || !job.outputReady) {
    return NextResponse.json({ error: "Output not ready" }, { status: 404 });
  }

  // "before" = the first cut, before the self-review fixed it.
  const before = request.nextUrl.searchParams.get("variant") === "before";
  if (before && !job.selfReview?.hasBefore) {
    return NextResponse.json({ error: "No before cut for this job" }, { status: 404 });
  }
  return serveFile(request, jobFile(jobId, before ? "output-before.mp4" : "output.mp4"), {
    contentType: "video/mp4",
    filename: `explaincut-${jobId}${before ? "-before" : ""}.mp4`,
    attachment: request.nextUrl.searchParams.get("download") === "1",
  });
}
