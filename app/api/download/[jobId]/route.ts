import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { jobFile } from "@/lib/paths";
import { getJob } from "@/lib/jobs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job || !job.outputReady) {
    return NextResponse.json({ error: "Output not ready" }, { status: 404 });
  }

  const asAttachment = request.nextUrl.searchParams.get("download") === "1";
  // "before" = the first cut, before the self-review fixed it.
  const before = request.nextUrl.searchParams.get("variant") === "before";
  if (before && !job.selfReview?.hasBefore) {
    return NextResponse.json({ error: "No before cut for this job" }, { status: 404 });
  }
  const buffer = await fs.readFile(jobFile(jobId, before ? "output-before.mp4" : "output.mp4"));
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="explaincut-${jobId}${before ? "-before" : ""}.mp4"`,
    },
  });
}
