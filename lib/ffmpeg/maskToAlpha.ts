import path from "node:path";
import fs from "node:fs/promises";
import { runFfmpeg } from "./run";

export interface MaskSample {
  /** Path to a grayscale/B&W PNG mask (white = speaker, black = background). */
  pngPath: string;
  intervalSeconds: number;
  /** The source video frame this mask was computed from (used for free-space/theme analysis). */
  framePath?: string;
}

/**
 * Builds a smoothed mask video from sparse still masks: holds each still for
 * its interval (ffmpeg concat demuxer with per-image `duration`), resamples
 * to a constant fps, then blends across nearby frames (tmix) so the hard
 * cuts between samples don't visibly "pop" the diagram's person-shaped hole
 * in and out. Returns the mask video's path.
 */
export async function buildSmoothedMaskVideo(
  samples: MaskSample[],
  workDir: string,
  fps = 30
): Promise<string> {
  await fs.mkdir(workDir, { recursive: true });

  const concatListPath = path.join(workDir, "mask-concat.txt");
  const lines = samples.flatMap((sample) => [
    `file '${sample.pngPath.replace(/'/g, "'\\''")}'`,
    `duration ${sample.intervalSeconds}`,
  ]);
  // ffmpeg's concat demuxer ignores the last entry's duration unless the file
  // is repeated once more without one.
  if (samples.length > 0) {
    lines.push(`file '${samples[samples.length - 1].pngPath.replace(/'/g, "'\\''")}'`);
  }
  await fs.writeFile(concatListPath, lines.join("\n"), "utf-8");

  const rawMaskVideoPath = path.join(workDir, "mask-video-raw.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    rawMaskVideoPath,
  ]);

  const smoothedMaskVideoPath = path.join(workDir, "mask-video-smoothed.mp4");
  await runFfmpeg([
    "-y",
    "-i",
    rawMaskVideoPath,
    "-vf",
    "tmix=frames=9:weights='1 2 3 4 5 4 3 2 1',format=gray",
    smoothedMaskVideoPath,
  ]);

  return smoothedMaskVideoPath;
}
