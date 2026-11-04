/**
 * Measured review checks - exact, model-free, and re-runnable after a fix:
 *  - timing:  every element is compared with the word that asked for it.
 *  - overlap: every element's box is compared with the SAM person masks while
 *             it's on screen (the composite hides anything behind the speaker).
 */
import sharp from "sharp";
import type { Rect, RenderElement, RenderPlan, RenderScene } from "@/types/diagramPlan";
import type { ReviewFinding } from "@/types/review";
import type { MaskSample } from "@/lib/ffmpeg/maskToAlpha";
import { LINE_HEIGHT_EM } from "@/lib/layout/geometry";

/** Matches the renderer's scene wipe. */
const ERASE_SECONDS = 0.45;
/** An element readable this long after its word feels late. */
const LATE_SECONDS = 1.6;
/** An element wiped this soon after it finished drawing is barely seen. */
const MIN_ON_SCREEN_SECONDS = 0.8;

export type MeasuredFinding = Omit<ReviewFinding, "id" | "status">;

const fmt = (s: number) => `${s.toFixed(1)} s`;

export function elementLabel(el: RenderElement): string {
  switch (el.kind) {
    case "node":
      return el.lines.join(" ");
    case "text":
      return el.lines.join(" ");
    case "bar":
    case "point":
      return el.label.replace(/\n/g, " ");
    case "slice":
      return el.lines.slice(0, -1).join(" ") || el.lines.join(" ");
    case "edge":
      return el.label ?? "arrow";
    case "sticker":
      return `${el.subject} sticker`;
    default:
      return el.kind;
  }
}

/** The area an element occupies, for the overlap check (lines, marks and packets tuck behind by design). */
export function elementBounds(el: RenderElement): Rect | null {
  switch (el.kind) {
    case "node":
      return el.box;
    case "text":
      return { x: el.x, y: el.y, w: el.blockWidth, h: el.lines.length * el.fontSize * LINE_HEIGHT_EM };
    case "bar":
      return el.bar;
    case "point":
      return { x: el.at.x - el.fontSize * 0.6, y: el.at.y - el.fontSize * 0.6, w: el.fontSize * 1.2, h: el.fontSize * 1.2 };
    case "slice":
      return { x: el.cx - el.r, y: el.cy - el.r, w: el.r * 2, h: el.r * 2 };
    case "sticker":
      return el.box;
    default:
      return null;
  }
}

/** Elements whose timing a viewer actually notices. */
const TIMED = new Set<RenderElement["kind"]>(["node", "text", "bar", "point", "slice", "sticker"]);

function lastVisibleFrame(scene: RenderScene, fps: number) {
  return scene.end - Math.round(ERASE_SECONDS * fps);
}

export function measureTiming(plan: RenderPlan): MeasuredFinding[] {
  const { fps } = plan;
  const out: MeasuredFinding[] = [];
  const seen = new Set<string>();
  for (const d of plan.dropped ?? []) {
    // Several ops can ask for the same missing element - report it once.
    const key = `${d.sceneId}:${d.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "timing",
      severity: "high",
      source: "measured",
      sceneId: d.sceneId,
      elementId: `${d.sceneId}:${d.target}`,
      target: d.label,
      time: d.frame / fps,
      title: `“${d.label}” never gets drawn`,
      detail: `The speaker mentions it at ${fmt(d.frame / fps)}, but the scene is wiped before the pen gets there.`,
      suggestion: "Trigger it earlier, drop a less important op, or give it its own scene.",
    });
  }
  for (const scene of plan.scenes) {
    const visibleUntil = lastVisibleFrame(scene, fps);
    for (const el of scene.elements) {
      if (!TIMED.has(el.kind) || el.cue === undefined) continue;
      const label = elementLabel(el);
      const said = el.cue / fps;
      const ready = (el.start + el.duration) / fps;
      const late = ready - said;
      const target = el.kind === "text" && el.variant === "title" ? `title “${label}”` : `“${label}”`;
      if (late > LATE_SECONDS) {
        out.push({
          kind: "timing",
          severity: late > LATE_SECONDS * 1.6 ? "high" : "medium",
          source: "measured",
          sceneId: scene.id,
          elementId: el.id,
          target: label,
          time: ready,
          title: `${target} finishes ${fmt(late)} after the word`,
          detail: `It's said at ${fmt(said)} but only readable at ${fmt(ready)} - the pen is queued behind other strokes.`,
          suggestion: "Trigger it on an earlier word, or space out the ops around it.",
        });
        continue;
      }
      const onScreen = (visibleUntil - (el.start + el.duration)) / fps;
      if (onScreen < MIN_ON_SCREEN_SECONDS) {
        out.push({
          kind: "timing",
          severity: onScreen < MIN_ON_SCREEN_SECONDS / 2 ? "high" : "medium",
          source: "measured",
          sceneId: scene.id,
          elementId: el.id,
          target: label,
          time: ready,
          title: `${target} is wiped ${fmt(Math.max(0, onScreen))} after it appears`,
          detail: "The next scene starts right after it finishes drawing, so viewers barely see it.",
          suggestion: "Trigger it earlier, or start the next scene a little later.",
        });
      }
    }
  }
  return out;
}

/** What the timing finding would say now, for the "after" side of a fixed finding. */
export function describeTimingNow(plan: RenderPlan, elementId: string): string | null {
  for (const scene of plan.scenes) {
    const el = scene.elements.find((e) => e.id === elementId);
    if (!el || el.cue === undefined) continue;
    const late = (el.start + el.duration - el.cue) / plan.fps;
    const onScreen = (lastVisibleFrame(scene, plan.fps) - (el.start + el.duration)) / plan.fps;
    return `Now readable ${fmt(Math.max(0, late))} after the word, on screen for ${fmt(Math.max(0, onScreen))}`;
  }
  return null;
}

interface LoadedMask {
  time: number;
  data: Uint8Array;
  w: number;
  h: number;
}

const MASK_SCALE = 4;

export async function loadMasks(samples: MaskSample[], width: number, height: number): Promise<LoadedMask[]> {
  const w = Math.max(1, Math.round(width / MASK_SCALE));
  const h = Math.max(1, Math.round(height / MASK_SCALE));
  return Promise.all(
    samples.map(async (s, i) => {
      const { data } = await sharp(s.pngPath).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
      return { time: i * s.intervalSeconds, data: new Uint8Array(data), w, h };
    })
  );
}

function coverage(mask: LoadedMask, r: Rect): number {
  const x0 = Math.max(0, Math.floor(r.x / MASK_SCALE));
  const y0 = Math.max(0, Math.floor(r.y / MASK_SCALE));
  const x1 = Math.min(mask.w, Math.ceil((r.x + r.w) / MASK_SCALE));
  const y1 = Math.min(mask.h, Math.ceil((r.y + r.h) / MASK_SCALE));
  let hit = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (mask.data[y * mask.w + x] > 127) hit++;
    }
  }
  return total ? hit / total : 0;
}

/** Fraction of each element hidden behind the speaker at its worst moment. */
export function measureOverlap(plan: RenderPlan, masks: LoadedMask[]): MeasuredFinding[] {
  if (masks.length === 0) return [];
  const { fps } = plan;
  const out: MeasuredFinding[] = [];
  for (const scene of plan.scenes) {
    // On the black board the speaker is faded out - nothing can be hidden behind them.
    if (scene.board) continue;
    const until = lastVisibleFrame(scene, fps) / fps;
    for (const el of scene.elements) {
      const box = elementBounds(el);
      if (!box) continue;
      const from = (el.start + el.duration) / fps;
      let worst = 0;
      let worstAt = from;
      for (const m of masks) {
        if (m.time < from - 0.2 || m.time > until) continue;
        const c = coverage(m, box);
        if (c > worst) {
          worst = c;
          worstAt = m.time;
        }
      }
      // Text is unreadable with far less hidden than a box.
      const limit = el.kind === "text" ? 0.15 : 0.25;
      if (worst <= limit) continue;
      const label = elementLabel(el);
      out.push({
        kind: "overlap",
        severity: worst > 0.5 ? "high" : "medium",
        source: "measured",
        sceneId: scene.id,
        elementId: el.id,
        target: label,
        time: worstAt,
        title: `“${label}” is ${Math.round(worst * 100)}% hidden behind the speaker`,
        detail: `At ${fmt(worstAt)} the speaker moves over it, and the cut-out hides that part of the drawing.`,
        suggestion: "Use fewer or shorter nodes in this scene, or a layout that keeps to the open space.",
      });
    }
  }
  return out;
}

export function describeOverlapNow(plan: RenderPlan, masks: LoadedMask[], elementId: string): string | null {
  for (const scene of plan.scenes) {
    const el = scene.elements.find((e) => e.id === elementId);
    const box = el ? elementBounds(el) : null;
    if (!el || !box) continue;
    const from = (el.start + el.duration) / plan.fps;
    const until = lastVisibleFrame(scene, plan.fps) / plan.fps;
    const worst = Math.max(0, ...masks.filter((m) => m.time >= from - 0.2 && m.time <= until).map((m) => coverage(m, box)));
    return `Now at most ${Math.round(worst * 100)}% hidden`;
  }
  return null;
}
