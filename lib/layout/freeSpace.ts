import sharp from "sharp";
import type { FreeRegion, FreeSpace, Rect, SketchTheme } from "@/types/diagramPlan";
import { defaultFreeSpace, sideOf } from "./defaultFreeSpace";

const GRID_COLS = 64;
/** A cell counts as "person" if the speaker covers it in more than this share of sampled frames. */
const OCCUPANCY_THRESHOLD = 0.1;
const MAX_REGIONS = 4;

interface Grid {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  blocked: Uint8Array; // 1 = person/margin/used
}

async function loadOccupancy(maskPaths: string[], cols: number, rows: number): Promise<Float32Array> {
  const counts = new Float32Array(cols * rows);
  let n = 0;
  for (const p of maskPaths) {
    try {
      const { data } = await sharp(p)
        .greyscale()
        .resize(cols, rows, { fit: "fill", kernel: "linear" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < counts.length; i++) if (data[i] > 40) counts[i] += 1;
      n++;
    } catch {
      // Unreadable mask - skip it rather than poison the whole analysis.
    }
  }
  if (n === 0) throw new Error("no readable masks");
  for (let i = 0; i < counts.length; i++) counts[i] /= n;
  return counts;
}

function personBox(occ: Float32Array, g: Grid): Rect | undefined {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (occ[r * g.cols + c] > OCCUPANCY_THRESHOLD) {
        minX = Math.min(minX, c); maxX = Math.max(maxX, c);
        minY = Math.min(minY, r); maxY = Math.max(maxY, r);
      }
    }
  }
  if (maxX < 0) return undefined;
  return {
    x: minX * g.cellW,
    y: minY * g.cellH,
    w: (maxX - minX + 1) * g.cellW,
    h: (maxY - minY + 1) * g.cellH,
  };
}

/** Marks every cell within `radius` cells of an occupied cell as blocked (a breathing margin around the speaker). */
function dilate(src: Uint8Array, g: Grid, radiusX: number, radiusY: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!src[r * g.cols + c]) continue;
      for (let dr = -radiusY; dr <= radiusY; dr++) {
        for (let dc = -radiusX; dc <= radiusX; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < g.rows && cc >= 0 && cc < g.cols) out[rr * g.cols + cc] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Exhaustive best-empty-rectangle search over the (small) grid using a 2D
 * prefix sum - ~10^7 O(1) checks, tens of milliseconds. Scored by area with a
 * penalty for sliver-thin strips, which are useless for drawing.
 */
function bestEmptyRect(g: Grid, minCols: number, minRows: number): { c: number; r: number; w: number; h: number } | null {
  const { cols, rows, blocked } = g;
  const ps = new Int32Array((cols + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ps[(r + 1) * (cols + 1) + (c + 1)] =
        blocked[r * cols + c] + ps[r * (cols + 1) + (c + 1)] + ps[(r + 1) * (cols + 1) + c] - ps[r * (cols + 1) + c];
    }
  }
  const sum = (c0: number, r0: number, c1: number, r1: number) =>
    ps[r1 * (cols + 1) + c1] - ps[r0 * (cols + 1) + c1] - ps[r1 * (cols + 1) + c0] + ps[r0 * (cols + 1) + c0];

  let best: { c: number; r: number; w: number; h: number } | null = null;
  let bestScore = 0;
  for (let r0 = 0; r0 < rows; r0++) {
    for (let c0 = 0; c0 < cols; c0++) {
      if (blocked[r0 * cols + c0]) continue;
      let maxC1 = cols;
      for (let r1 = r0 + 1; r1 <= rows; r1++) {
        // Widest empty run for this row band, shrinking as we go down.
        let c1 = c0 + 1;
        while (c1 <= maxC1 && sum(c0, r0, c1, r1) === 0) c1++;
        c1--;
        if (c1 <= c0) break;
        maxC1 = c1;
        const w = c1 - c0;
        const h = r1 - r0;
        if (w < minCols || h < minRows) continue;
        const pxW = w * g.cellW, pxH = h * g.cellH;
        const aspect = Math.max(pxW, pxH) / Math.min(pxW, pxH);
        const score = pxW * pxH * (aspect > 4 ? 4 / aspect : 1);
        if (score > bestScore) {
          bestScore = score;
          best = { c: c0, r: r0, w, h };
        }
      }
    }
  }
  return best;
}

async function pickTheme(framePaths: string[], region: Rect | undefined): Promise<SketchTheme> {
  if (!region || framePaths.length === 0) return "ink";
  const step = Math.max(1, Math.floor(framePaths.length / 6));
  let total = 0, n = 0;
  for (let i = 0; i < framePaths.length; i += step) {
    try {
      const meta = await sharp(framePaths[i]).metadata();
      const W = meta.width ?? 0, H = meta.height ?? 0;
      const left = Math.max(0, Math.min(W - 1, Math.round(region.x)));
      const top = Math.max(0, Math.min(H - 1, Math.round(region.y)));
      const width = Math.max(1, Math.min(W - left, Math.round(region.w)));
      const height = Math.max(1, Math.min(H - top, Math.round(region.h)));
      const stats = await sharp(framePaths[i]).extract({ left, top, width, height }).greyscale().stats();
      total += stats.channels[0].mean;
      n++;
    } catch {
      /* ignore */
    }
  }
  if (n === 0) return "ink";
  return total / n / 255 > 0.45 ? "ink" : "chalk";
}

/**
 * Turns the per-frame SAM person masks into the places we're allowed to
 * draw: the union of where the speaker ever is (ignoring brief hand
 * gestures), padded, minus a social-media safe area, then carved into up to
 * four large empty rectangles - typically "above the head", "left of the
 * person", "right of the person".
 */
export async function analyzeFreeSpace(
  maskPaths: string[],
  framePaths: string[],
  width: number,
  height: number
): Promise<FreeSpace> {
  const cols = GRID_COLS;
  const rows = Math.max(16, Math.round((GRID_COLS * height) / width));
  const g: Grid = { cols, rows, cellW: width / cols, cellH: height / rows, blocked: new Uint8Array(cols * rows) };

  let occ: Float32Array;
  try {
    occ = await loadOccupancy(maskPaths, cols, rows);
  } catch {
    const fallback = defaultFreeSpace(width, height);
    fallback.theme = await pickTheme(framePaths, fallback.regions[0]);
    return fallback;
  }

  const person = personBox(occ, g);
  const occupied = new Uint8Array(cols * rows);
  for (let i = 0; i < occ.length; i++) occupied[i] = occ[i] > OCCUPANCY_THRESHOLD ? 1 : 0;

  // Breathing room around the speaker (~3% of the short side).
  const marginPx = Math.min(width, height) * 0.03;
  g.blocked = dilate(occupied, g, Math.ceil(marginPx / g.cellW), Math.ceil(marginPx / g.cellH));

  // Safe area: keep clear of frame edges and of the top/bottom bands that
  // Reels/TikTok/Shorts cover with their own UI.
  const portrait = height > width;
  const safeTop = Math.ceil((portrait ? 0.06 : 0.04) * rows);
  const safeBottom = Math.ceil((portrait ? 0.14 : 0.05) * rows);
  const safeSide = Math.ceil(0.035 * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < safeTop || r >= rows - safeBottom || c < safeSide || c >= cols - safeSide) g.blocked[r * cols + c] = 1;
    }
  }

  const minCols = Math.ceil(cols * 0.16);
  const minRows = Math.ceil(rows * (portrait ? 0.07 : 0.12));
  const regions: FreeRegion[] = [];
  for (let i = 0; i < MAX_REGIONS; i++) {
    const best = bestEmptyRect(g, minCols, minRows);
    if (!best) break;
    const rect: Rect = { x: best.c * g.cellW, y: best.r * g.cellH, w: best.w * g.cellW, h: best.h * g.cellH };
    // Ignore crumbs once we have something decent.
    if (regions.length > 0 && rect.w * rect.h < regions[0].w * regions[0].h * 0.12) break;
    regions.push({ ...rect, side: sideOf(rect, person, width, height) });
    // Block it (plus a one-cell gutter) so the next pick is a different area.
    for (let r = Math.max(0, best.r - 1); r < Math.min(rows, best.r + best.h + 1); r++) {
      for (let c = Math.max(0, best.c - 1); c < Math.min(cols, best.c + best.w + 1); c++) g.blocked[r * cols + c] = 1;
    }
  }

  if (regions.length === 0) {
    // The speaker fills the frame. Draw above anyway - the composite keeps
    // the speaker in front, so lines just tuck behind them.
    const fallback = defaultFreeSpace(width, height);
    return { ...fallback, person, theme: await pickTheme(framePaths, fallback.regions[0]) };
  }

  return { width, height, person, regions, theme: await pickTheme(framePaths, regions[0]) };
}

/** One-line human/LLM-readable description of the drawable area. */
export function describeFreeSpace(space: FreeSpace): string {
  const pct = (v: number, of: number) => Math.round((v / of) * 100);
  const parts = space.regions.map(
    (r, i) =>
      `${i === 0 ? "MAIN" : "extra"} area ${r.side} of the speaker: ${pct(r.w, space.width)}% of frame width x ${pct(
        r.h,
        space.height
      )}% of frame height (aspect ${(r.w / r.h).toFixed(1)}:1)`
  );
  return `Video is ${space.width}x${space.height} (${space.height > space.width ? "portrait" : "landscape"}). Drawable areas: ${parts.join("; ")}.`;
}
