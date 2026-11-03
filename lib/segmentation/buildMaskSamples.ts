import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { extractFrames } from "@/lib/ffmpeg/extractFrames";
import { segmentPerson } from "@/lib/meta/sam";
import type { MaskSample } from "@/lib/ffmpeg/maskToAlpha";

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
  const samples: MaskSample[] = [];

  for (const frame of frames) {
    const frameBuffer = await fs.readFile(frame.path);
    const metadata = await sharp(frameBuffer).metadata();
    const width = metadata.width ?? 1280;
    const height = metadata.height ?? 720;

    let maskBuffer: Buffer;
    try {
      const result = await segmentPerson(frameBuffer, width, height);
      maskBuffer = result ?? (await centerEllipseMask(width, height));
    } catch (err) {
      console.error(`SAM 3.1 failed for ${frame.path}, using center-ellipse fallback:`, err);
      maskBuffer = await centerEllipseMask(width, height);
    }

    const maskPath = path.join(masksDir, path.basename(frame.path));
    await fs.writeFile(maskPath, maskBuffer);
    samples.push({ pngPath: maskPath, intervalSeconds: SAMPLE_INTERVAL_SECONDS, framePath: frame.path });
  }

  return samples;
}
