import path from "node:path";
import fs from "node:fs/promises";
import { runFfmpeg } from "./run";

export interface SampledFrame {
  path: string;
  timestampSeconds: number;
}

/**
 * Samples frames from a video at a fixed interval (default every 500ms) rather
 * than every frame - SAM 3.1 calls are per-sample, not per-frame, to keep the
 * pipeline fast. Downstream code holds/interpolates each sample's mask across
 * its interval.
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  intervalSeconds = 0.5
): Promise<SampledFrame[]> {
  await fs.mkdir(outDir, { recursive: true });
  const pattern = path.join(outDir, "frame-%04d.png");
  await runFfmpeg(["-y", "-i", videoPath, "-vf", `fps=1/${intervalSeconds}`, pattern]);

  const files = (await fs.readdir(outDir)).filter((f) => f.startsWith("frame-")).sort();
  return files.map((filename, i) => ({
    path: path.join(outDir, filename),
    timestampSeconds: i * intervalSeconds,
  }));
}
