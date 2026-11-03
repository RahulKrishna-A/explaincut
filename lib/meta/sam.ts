import OpenAI from "openai";
import sharp from "sharp";
import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type SegmentationMaskRecord,
} from "@meta-sam/parser";

const MODEL_ID = "sam-3.1";

function client(): OpenAI {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) {
    throw new Error("MODEL_API_KEY is not set. Add it to .env.local (see .env.example).");
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1",
  });
}

/** Builds a full-frame grayscale PNG (white=person) from a mask record's cropped raster + bounds. */
async function recordToFullFrameMaskPng(
  record: SegmentationMaskRecord,
  frameWidth: number,
  frameHeight: number
): Promise<Buffer> {
  const raster = decodeMaskToRaster(record.mask); // row-major 0/1, size mask.width * mask.height
  const scaled = new Uint8Array(raster.length);
  for (let i = 0; i < raster.length; i++) scaled[i] = raster[i] ? 255 : 0;

  const croppedBuffer = await sharp(Buffer.from(scaled), {
    raw: { width: record.mask.width, height: record.mask.height, channels: 1 },
  })
    .png()
    .toBuffer();

  const left = Math.round(record.bounds.left);
  const top = Math.round(record.bounds.top);

  return sharp({
    create: {
      width: frameWidth,
      height: frameHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: croppedBuffer, left, top }])
    .png()
    .toBuffer();
}

/**
 * Segments the person out of a single frame via SAM 3.1, following the real
 * documented contract (https://dev.meta.ai/docs/sam/overview): a concept
 * prompt ("person") over the Responses API, streamed and decoded with Meta's
 * own @meta-sam/parser. Returns a ready-to-use full-frame grayscale PNG
 * (white=person) built from the returned mask raster + its bounding box.
 */
export async function segmentPerson(
  pngBuffer: Buffer,
  frameWidth: number,
  frameHeight: number
): Promise<Buffer | null> {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

  const stream = await client().responses.create({
    model: MODEL_ID,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "person" },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
    stream: true,
    metadata: { mask_encoding: "one_bit" },
  });

  const parsed = parseImageStream(stream);
  const result = await parsed.finalResult;

  const maskRecords = recordsOfKind(result.records, "mask");
  if (maskRecords.length === 0) {
    return null;
  }

  // One person per webcam frame expected - take the largest mask if several
  // objects matched the "person" concept prompt.
  const largest = maskRecords.reduce((best, r) =>
    r.mask.width * r.mask.height > best.mask.width * best.mask.height ? r : best
  );

  return recordToFullFrameMaskPng(largest, frameWidth, frameHeight);
}
