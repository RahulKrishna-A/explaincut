import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { jobDir, jobFile } from "@/lib/paths";
import { createJob } from "@/lib/jobs";

/** Generous for a 2-minute phone/webcam clip, small enough to keep a local server healthy. */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form with a 'video' file" }, { status: 400 });
  }
  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'video' file field" }, { status: 400 });
  }
  if (file.type && !file.type.startsWith("video/")) {
    return NextResponse.json({ error: "That file isn't a video. Upload an MP4 or MOV." }, { status: 415 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The video file is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That video is over 1 GB. Trim it to under 2 minutes and try again." }, { status: 413 });
  }

  const jobId = randomUUID();
  await fs.mkdir(jobDir(jobId), { recursive: true });
  await fs.writeFile(jobFile(jobId, "input.mp4"), Buffer.from(await file.arrayBuffer()));
  // Register the job only once its input is safely on disk.
  createJob(jobId);

  return NextResponse.json({ jobId });
}
