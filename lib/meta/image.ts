import { metaPostJSON } from "./client";

/**
 * Muse Image (muse-image-1.0) - POST /v1/images/generations.
 * $0.01 per image. The output background is always opaque (no transparency
 * parameter), so callers that need a cut-out ask for a flat key colour and
 * remove it themselves (see lib/stickers/cutout.ts).
 */
const MODEL_ID = "muse-image-1.0";

interface ImageGenerationResponse {
  data?: { b64_json?: string; url?: string }[];
}

export async function generateImage(prompt: string, size = "1024x1024"): Promise<Buffer> {
  const body = {
    model: MODEL_ID,
    prompt,
    n: 1,
    size,
    response_format: "b64_json",
    output_format: "png",
    // A sticker never needs web/image search or a shell - skipping them keeps it fast.
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  };
  const res = (await metaPostJSON("/images/generations", body)) as ImageGenerationResponse;
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Muse Image returned no image: ${JSON.stringify(res).slice(0, 300)}`);
  return Buffer.from(b64, "base64");
}
