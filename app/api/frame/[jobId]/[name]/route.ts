import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/lib/paths";
import { getJob } from "@/lib/jobs";

/** Only the self-review thumbnails, never arbitrary files from the job folder. */
const FRAME_NAME = /^(before|after)-\d{1,2}\.jpg$/;

/** Serves a self-review frame thumbnail (before/after the fix). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string; name: string }> }) {
  const { jobId, name } = await params;
  if (!getJob(jobId) || !FRAME_NAME.test(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const buffer = await fs.readFile(path.join(jobDir(jobId), "review", name));
    return new NextResponse(buffer, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
