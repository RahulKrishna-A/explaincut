import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { extractFrames } from "@/lib/ffmpeg/extractFrames";
import { segmentPerson } from "@/lib/meta/sam";
import type { MaskSample } from "@/lib/ffmpeg/maskToAlpha";
import { mapPool, withRetry } from "@/lib/util/pool";

const SAMPLE_INTERVAL_SECONDS = 0.4;

async function ellipseSvgToPng(
  width: number,
  height: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="black" />
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Centered-ellipse fallback - a reasonable guess for a webcam talking-head frame. */
function centerEllipseMask(width: number, height: number): Promise<Buffer> {
  return ellipseSvgToPng(width, height, width / 2, height * 0.55, width * 0.28, height * 0.42);
}

/**
 * SAM calls in flight at once. One-at-a-time made segmentation the slowest
 * stage (~2 s x 50+ frames); a small pool cuts it ~6x while staying polite
 * to the API's rate limits. Override with SAM_CONCURRENCY.
 */
const SAM_CONCURRENCY = Math.max(1, Number(process.env.SAM_CONCURRENCY) || 6);

/** SAM's mask for one frame (retrying transient failures), or the centred-ellipse guess if SAM finds nothing or keeps failing. */
async function samMaskOrFallback(frame: Buffer, width: number, height: number, label: string): Promise<Buffer> {
  try {
    return (await withRetry(() => segmentPerson(frame, width, height))) ?? (await centerEllipseMask(width, height));
  } catch (err) {
    console.error(`SAM 3.1 failed for ${label} after retries, using center-ellipse fallback:`, err);
    return centerEllipseMask(width, height);
  }
}

/**
 * Samples frames from the speaker video and gets a person mask for each via
 * SAM 3.1. Degrades gracefully per-frame: real mask -> bbox-derived ellipse ->
 * centered-ellipse guess - a single SAM failure never aborts the whole job.
 */
export async function buildMaskSamples(
  speakerVideoPath: string,
  workDir: string
): Promise<MaskSample[]> {
  const framesDir = path.join(workDir, "frames");
  const masksDir = path.join(workDir, "masks");
  await fs.mkdir(masksDir, { recursive: true });

  const frames = await extractFrames(speakerVideoPath, framesDir, SAMPLE_INTERVAL_SECONDS);
  // No key: every SAM call would fail - say so once instead of once per frame.
  const samAvailable = !!process.env.MODEL_API_KEY;
  if (!samAvailable) console.warn("MODEL_API_KEY is not set - using a centred-ellipse speaker mask for every frame.");

  // Frames are segmented in parallel; results keep frame order (the mask video depends on it).
  return mapPool(frames, samAvailable ? SAM_CONCURRENCY : 4, async (frame): Promise<MaskSample> => {
    const frameBuffer = await fs.readFile(frame.path);
    const metadata = await sharp(frameBuffer).metadata();
    const width = metadata.width ?? 1280;
    const height = metadata.height ?? 720;

    const maskBuffer = samAvailable
      ? await samMaskOrFallback(frameBuffer, width, height, frame.path)
      : await centerEllipseMask(width, height);

    const maskPath = path.join(masksDir, path.basename(frame.path));
    await fs.writeFile(maskPath, maskBuffer);
    return { pngPath: maskPath, intervalSeconds: SAMPLE_INTERVAL_SECONDS, framePath: frame.path };
  });
}
