import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateImage } from "@/lib/meta/image";
import { stickerCacheDir } from "@/lib/paths";
import { stickerKey } from "@/lib/layout/stickerKey";
import { cutOutSticker } from "./cutout";
import type { ResolvedDiagramPlan, StickerAssets } from "@/types/diagramPlan";

/** Bump when the prompt or cutout changes, so old cached stickers aren't reused. */
const STYLE_VERSION = "v1";
const MAX_PARALLEL = 4;
const TIMEOUT_MS = 60_000;

export function stickerPrompt(subject: string): string {
  return [
    `A single die-cut sticker illustration of ${subject}.`,
    "Cute hand-drawn doodle style: bold dark marker outlines, flat bright colours, simple rounded shapes, a little playful.",
    "A thick clean white border runs around the whole silhouette, like a real vinyl sticker.",
    "No text, no letters, no numbers. One object only, centred, filling most of the frame.",
    "Plain flat solid pure green (#00FF00) background - no shadow, no gradient, no scenery.",
  ].join(" ");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

/** One sticker, from the shared on-disk cache when we've drawn this subject before. */
async function stickerFor(subject: string): Promise<{ png: Buffer; width: number; height: number }> {
  const dir = stickerCacheDir();
  const file = path.join(dir, `${createHash("sha1").update(`${STYLE_VERSION}:${stickerKey(subject)}`).digest("hex").slice(0, 16)}.png`);
  try {
    const png = await fs.readFile(file);
    const meta = await (await import("sharp")).default(png).metadata();
    return { png, width: meta.width ?? 1, height: meta.height ?? 1 };
  } catch {
    // not cached yet
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await withTimeout(generateImage(stickerPrompt(subject)), TIMEOUT_MS);
      const cut = await cutOutSticker(raw);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, cut.png);
      return cut;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Generates (Muse Image) and cuts out every sticker the plan asks for.
 * Never throws: a sticker that fails is simply left out, and the layout
 * skips any sticker op without an asset.
 */
export async function prepareStickers(plan: ResolvedDiagramPlan, existing: StickerAssets = {}): Promise<{ assets: StickerAssets; failed: string[] }> {
  const subjects = [
    ...new Set(
      plan.scenes.flatMap((s) => s.ops.filter((o) => o.type === "sticker" && o.text?.trim()).map((o) => o.text!.trim()))
    ),
  ].filter((s) => !existing[stickerKey(s)]);
  const assets: StickerAssets = { ...existing };
  const failed: string[] = [];
  if (subjects.length > 0 && !process.env.MODEL_API_KEY) return { assets, failed: subjects };

  let next = 0;
  const worker = async () => {
    while (next < subjects.length) {
      const subject = subjects[next++];
      try {
        const s = await stickerFor(subject);
        assets[stickerKey(subject)] = { src: `data:image/png;base64,${s.png.toString("base64")}`, width: s.width, height: s.height };
      } catch (err) {
        console.error(`Sticker "${subject}" failed (leaving it out):`, err);
        failed.push(subject);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, subjects.length) }, worker));
  return { assets, failed };
}
