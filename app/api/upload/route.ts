import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { jobDir, jobFile } from "@/lib/paths";
import { createJob } from "@/lib/jobs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("video");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'video' file field" }, { status: 400 });
  }

  const jobId = randomUUID();
  createJob(jobId);
  await fs.mkdir(jobDir(jobId), { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(jobFile(jobId, "input.mp4"), buffer);

  return NextResponse.json({ jobId });
}
