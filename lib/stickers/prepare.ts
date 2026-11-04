import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateImage } from "@/lib/meta/image";
import { stickerCacheDir } from "@/lib/paths";
import { stickerKey } from "@/lib/layout/stickerKey";
import { cutOutSticker, type Cutout } from "./cutout";
import { pickBestSticker } from "@/lib/meta/wonder";
import { withRetry } from "@/lib/util/pool";
import type { ResolvedDiagramPlan, StickerAssets } from "@/types/diagramPlan";
import { DEFAULT_TONE, toneProfile, type Tone } from "@/lib/style/tone";

/** Bump when the prompt or cutout changes, so old cached stickers aren't reused. */
const STYLE_VERSION = "v3";
const MAX_PARALLEL = 5;
const TIMEOUT_MS = 60_000;

/** The drawing layer's accent colours, so palette-friendly tones sit in the same world as the diagram. */
const HOUSE_PALETTE = "cobalt blue, raspberry pink, emerald green, tangerine orange and violet";

/**
 * Subjects that carry no meaning as a picture - a speech bubble, an arrow, a
 * plain shape or some text. The planner is told to avoid them; this catches
 * the ones that slip through rather than spending a generation on them.
 */
const LOW_INFORMATION = /^(an? )?(empty |blank |plain |simple )?(speech bubble|chat bubble|thought bubble|text|word|label|arrow|check ?mark|tick|circle|square|rectangle|box|shape|logo|icon|button|question mark)s?\b/i;

export function isLowInformationSubject(subject: string): boolean {
  return LOW_INFORMATION.test(subject.trim());
}

/**
 * Muse Image prompt for one sticker. `subject` is the planner's art direction
 * (what it is, what it's doing, the mood); the tone adds the art style. The
 * model is asked for NO border - the cutout step adds an even die-cut border
 * itself, so every sticker gets the same clean edge.
 */
export function stickerPrompt(subject: string, tone: Tone = DEFAULT_TONE): string {
  const profile = toneProfile(tone);
  return [
    `A single sticker illustration: ${subject}.`,
    profile.stickerStyle,
    profile.usePalette ? `Use a colour palette built from ${HOUSE_PALETTE}.` : "",
    "One subject only, centred, filling most of the frame, with a clear readable silhouette.",
    "No text, no letters, no numbers. No border, no outline frame, no card or label behind it.",
    "Plain flat solid pure green (#00FF00) background - no shadow, no gradient, no scenery.",
  ]
    .filter(Boolean)
    .join(" ");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

/** Muse Image candidates per sticker; Muse Wonder picks the best. */
const CANDIDATES = 3;
/** Below this Wonder score (0-10) every candidate is a miss - draw a fresh round once. */
const ACCEPT_SCORE = 6;
const JUDGE_TIMEOUT_MS = 60_000;

async function generateCandidate(subject: string, tone: Tone): Promise<Cutout> {
  return withRetry(() => withTimeout(generateImage(stickerPrompt(subject, tone)), TIMEOUT_MS).then(cutOutSticker), 2, 800);
}

/** The cutout on a neutral grey (like the wall behind a speaker), as the judge sees it. */
async function judgeView(c: Cutout): Promise<string> {
  const sharp = (await import("sharp")).default;
  const jpg = await sharp(c.png).resize(512, 512, { fit: "inside" }).flatten({ background: "#8a8a8a" }).jpeg({ quality: 85 }).toBuffer();
  return jpg.toString("base64");
}

/** Muse Wonder's pick among cut-out candidates; falls back to the first one if the judge is unavailable. */
async function judge(subject: string, tone: Tone, cands: Cutout[]): Promise<{ best: Cutout; score: number }> {
  if (cands.length === 1) return { best: cands[0], score: ACCEPT_SCORE };
  try {
    const views = await Promise.all(cands.map(judgeView));
    const v = await withTimeout(pickBestSticker(subject, toneProfile(tone).stickerStyle, views), JUDGE_TIMEOUT_MS);
    console.log(`Sticker "${subject}" (${tone}): scores [${v.scores.join(", ")}] -> #${v.best + 1}${v.reason ? ` (${v.reason})` : ""}`);
    return { best: cands[v.best], score: v.scores[v.best] };
  } catch (err) {
    console.error(`Sticker judge failed for "${subject}" (using the first candidate):`, err);
    return { best: cands[0], score: ACCEPT_SCORE };
  }
}

/**
 * One sticker, from the shared on-disk cache when we've drawn this subject
 * before. Otherwise: several Muse Image candidates in parallel, each cut out,
 * and Muse Wonder art-directs the pick - with one fresh round if every
 * candidate misses.
 */
async function stickerFor(subject: string, tone: Tone): Promise<Cutout> {
  const dir = stickerCacheDir();
  const file = path.join(dir, `${createHash("sha1").update(`${STYLE_VERSION}:${stickerKey(subject, tone)}`).digest("hex").slice(0, 16)}.png`);
  try {
    const png = await fs.readFile(file);
    const meta = await (await import("sharp")).default(png).metadata();
    return { png, width: meta.width ?? 1, height: meta.height ?? 1 };
  } catch {
    // not cached yet
  }
  let pool: Cutout[] = [];
  let pick: { best: Cutout; score: number } | undefined;
  for (let round = 0; round < 2; round++) {
    const settled = await Promise.allSettled(Array.from({ length: CANDIDATES }, () => generateCandidate(subject, tone)));
    const fresh = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (fresh.length === 0) {
      if (pool.length > 0) break;
      throw (settled.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    }
    const roundPick = await judge(subject, tone, fresh);
    if (!pick || roundPick.score > pick.score) pick = roundPick;
    pool = pool.concat(fresh);
    if (pick.score >= ACCEPT_SCORE) break;
    console.log(`Sticker "${subject}" (${tone}): best candidate scored ${pick.score}/10 - drawing another round`);
  }
  const best = pick!.best;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, best.png);
  return best;
}

/**
 * Generates (Muse Image) and cuts out every sticker the plan asks for.
 * Never throws: a sticker that fails is simply left out, and the layout
 * skips any sticker op without an asset.
 */
export async function prepareStickers(plan: ResolvedDiagramPlan, existing: StickerAssets = {}): Promise<{ assets: StickerAssets; failed: string[] }> {
  // One request per distinct (tone, subject) - the same subject in two tones is two different stickers.
  const wanted = new Map<string, { subject: string; tone: Tone }>();
  for (const scene of plan.scenes) {
    const tone = scene.tone ?? DEFAULT_TONE;
    for (const op of scene.ops) {
      const subject = op.type === "sticker" ? op.text?.trim() : undefined;
      if (!subject || isLowInformationSubject(subject)) continue;
      const key = stickerKey(subject, tone);
      if (!existing[key]) wanted.set(key, { subject, tone });
    }
  }
  const jobs = [...wanted.entries()];
  const assets: StickerAssets = { ...existing };
  const failed: string[] = [];
  if (jobs.length > 0 && !process.env.MODEL_API_KEY) return { assets, failed: jobs.map(([, j]) => j.subject) };

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [key, { subject, tone }] = jobs[next++];
      try {
        const s = await stickerFor(subject, tone);
        assets[key] = { src: `data:image/png;base64,${s.png.toString("base64")}`, width: s.width, height: s.height };
      } catch (err) {
        console.error(`Sticker "${subject}" (${tone}) failed (leaving it out):`, err);
        failed.push(subject);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, jobs.length) }, worker));
  return { assets, failed };
}
