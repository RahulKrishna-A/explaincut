/**
 * "Board" scenes: for the one or two most complex explanations in a clip the
 * speaker fades out to a full-screen black canvas, the drawing takes the
 * whole frame, and then it fades back to the speaker.
 *
 * Shared by the layout (where to draw), the renderer (the black backdrop) and
 * the compositor (no speaker punch-out while the board is up).
 */
import type { FreeRegion, FreeSpace, Rect, RenderPlan } from "@/types/diagramPlan";

/** How long the cut to (and back from) the black board takes. */
export const BOARD_FADE_SECONDS = 0.5;

/**
 * Drawable area of a board scene: the whole frame inside a comfortable margin,
 * stopping above the caption band when captions are on.
 */
export function boardRect(width: number, height: number, bottomLimit?: number): Rect {
  const u = Math.min(width, height) / 100;
  const side = u * 6;
  const top = u * 7;
  const bottom = Math.min(height - u * 7, (bottomLimit ?? height) - u * 3);
  return { x: side, y: top, w: width - side * 2, h: Math.max(u * 20, bottom - top) };
}

/** The free space a board scene lays out in: one big region, no speaker to avoid. */
export function boardSpace(space: FreeSpace): FreeSpace {
  const r = space.board ?? boardRect(space.width, space.height, Math.min(space.height, ...space.regions.map((g) => g.y + g.h), space.height * 0.84));
  const region: FreeRegion = { ...r, side: "center" };
  return { ...space, regions: [region], person: undefined, theme: "chalk" };
}

/**
 * Frame windows where the board covers the speaker (fades included). Back-to-back
 * board scenes merge into one window - the screen stays black between them.
 */
export function boardFrameWindows(plan: Pick<RenderPlan, "scenes">): { in: number; out: number }[] {
  const out: { in: number; out: number }[] = [];
  for (const s of plan.scenes) {
    if (!s.board) continue;
    const last = out[out.length - 1];
    if (last && s.board.in <= last.out + 2) last.out = Math.max(last.out, s.board.out);
    else out.push({ ...s.board });
  }
  return out;
}

/** The same windows in seconds, padded half a frame, for ffmpeg's timeline expressions. */
export function boardSecondWindows(plan: Pick<RenderPlan, "scenes" | "fps">): [number, number][] {
  return boardFrameWindows(plan).map((w) => [Math.max(0, (w.in - 0.5) / plan.fps), (w.out + 0.5) / plan.fps]);
}

/** Opacity of the black backdrop at a frame (0 = speaker, 1 = fully black). */
export function boardOpacity(windows: { in: number; out: number }[], frame: number, fps: number): number {
  const fade = Math.max(1, Math.round(BOARD_FADE_SECONDS * fps));
  let best = 0;
  for (const w of windows) {
    if (frame < w.in || frame > w.out) continue;
    const a = Math.min(1, (frame - w.in) / fade, (w.out - frame) / fade);
    best = Math.max(best, a);
  }
  // Ease, so the cut breathes rather than ramps.
  return best * best * (3 - 2 * best);
}
