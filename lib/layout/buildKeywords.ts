import type { FreeSpace, KeywordElement, ResolvedDiagramPlan } from "@/types/diagramPlan";

const STOP = new Set(
  "the and for with that this from have has had was were are not but you your its it's can will just then them they there their what when where which while also very more most some into than over out about been being does did doing done our all any how why who".split(" ")
);
/** Ops whose trigger word is a concept the speaker is naming (not a connective like "that"). */
const KEY_OPS = new Set(["draw", "title", "plot", "circle", "highlight", "note", "sticker", "sparkle", "underline"]);

const SHOW_SECONDS = 1.0;
const MIN_GAP_SECONDS = 2.6;
const LEAD_FRAMES = 2;

const clean = (w: string) => w.replace(/[^\p{L}\p{N}%$]/gu, "");

export function keywordFontSize(text: string, width: number, height: number): number {
  const u = Math.min(width, height) / 100;
  return Math.max(u * 9, Math.min(u * 21, (width * 0.92) / (0.82 * Math.max(3, text.length))));
}

/** Where the headTops sample at frame f is. */
function headTopAt(space: FreeSpace, f: number, fps: number): number {
  const ht = space.headTops;
  if (!ht || ht.y.length === 0) return space.person?.y ?? space.height * 0.35;
  const i = Math.min(ht.y.length - 1, Math.max(0, Math.round(f / fps / ht.intervalSeconds)));
  return ht.y[i];
}

/**
 * Picks the words worth a giant callout - concepts the plan already anchors to
 * a spoken word - spaced out so they punctuate rather than spam. Each sits right
 * above the speaker's head and appears the instant the word is said.
 */
export function buildKeywords(plan: ResolvedDiagramPlan, space: FreeSpace, fps: number, totalFrames: number): KeywordElement[] {
  const cands: { text: string; frame: number }[] = [];
  const seen = new Set<string>();
  for (const scene of plan.scenes)
    for (const op of scene.ops) {
      if (!KEY_OPS.has(op.type)) continue;
      const text = clean(op.trigger.word);
      const key = text.toLowerCase();
      if (text.length < 4 && !/\d/.test(text)) continue;
      if (STOP.has(key) || seen.has(key)) continue;
      seen.add(key);
      cands.push({ text: text.toUpperCase(), frame: op.frame });
    }
  cands.sort((a, b) => a.frame - b.frame);

  const out: KeywordElement[] = [];
  const duration = Math.round(SHOW_SECONDS * fps);
  let lastEnd = -Infinity;
  for (const c of cands) {
    const start = Math.max(0, c.frame - LEAD_FRAMES);
    if (start - lastEnd < MIN_GAP_SECONDS * fps - duration || start + duration > totalFrames) continue;
    const fontSize = keywordFontSize(c.text, space.width, space.height);
    // Median head height over the time it's shown, so it doesn't jitter with the speaker's bobbing.
    const tops = [0, 0.5, 1].map((k) => headTopAt(space, start + k * duration, fps)).sort((a, b) => a - b);
    // Caps are ~0.72em tall: bottom 30% of the letters tuck behind the head.
    const cy = Math.max(fontSize * 0.5, tops[1] - fontSize * 0.14);
    out.push({ id: `kw:${out.length}`, kind: "keyword", text: c.text, start, duration, seed: out.length * 7919, cx: space.width / 2, cy, fontSize });
    lastEnd = start + duration;
  }
  return out;
}

/** Keeps the drawings clear of the band the keywords occupy above the head. */
export function reserveKeywordBand(space: FreeSpace): FreeSpace {
  const u = Math.min(space.width, space.height) / 100;
  const tops = space.headTops?.y ?? [];
  const top = tops.length ? Math.min(...tops) : (space.person?.y ?? space.height * 0.35);
  const limit = top - u * 12 - u * 2; // ~ half the largest keyword + margin
  const regions = space.regions
    .map((r) => (r.y + r.h > limit ? { ...r, h: limit - r.y } : r))
    .filter((r) => r.h >= u * 12)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  return regions.length > 0 ? { ...space, regions } : space;
}
