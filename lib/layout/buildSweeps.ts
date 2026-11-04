import type { Accent, FreeSpace, RenderScene, SweepElement } from "@/types/diagramPlan";

const VARIANTS: SweepElement["variant"][] = ["scribble", "eraser", "highlighter"];
const COLORS: Accent[] = ["pink", "blue", "orange", "purple", "green"];
const SWEEP_SECONDS = 1.15;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Gestures that cross the whole frame and slip behind the speaker. One sweeps
 * in at every scene change (where the drawing is wiped away anyway), plus an
 * opening one. Direction alternates, and the path runs through the speaker's
 * head/shoulder band so it is guaranteed to pass behind them and come out the
 * other side - the compositor hides whatever the mask covers.
 */
export function buildSweeps(scenes: RenderScene[], space: FreeSpace, fps: number, totalFrames: number): SweepElement[] {
  const { width: W, height: H } = space;
  const u = Math.min(W, H) / 100;
  const person = space.person ?? { x: W * 0.2, y: H * 0.3, w: W * 0.6, h: H * 0.7 };
  const frames = Math.max(8, Math.round(SWEEP_SECONDS * fps));

  // Cue frames: just before each scene's wipe, plus the very start of the clip.
  const cues: number[] = [Math.round(fps * 0.35)];
  for (const s of scenes) cues.push(Math.max(0, s.end - Math.round(fps * 0.75)));
  const usable = cues.filter((f) => f + frames < totalFrames);

  const sweeps: SweepElement[] = [];
  usable.forEach((start, i) => {
    const seed = hash(`sweep-${i}`);
    const variant = VARIANTS[i % VARIANTS.length];
    const rightToLeft = i % 2 === 1;
    // Band through the head and shoulders; vary it a little per sweep so they don't stack.
    const band = [0.1, 0.32, 0.18, 0.4][i % 4];
    const cy = Math.min(H * 0.92, person.y + person.h * band);
    const amp = (variant === "highlighter" ? 0.4 : variant === "eraser" ? 1.6 : 3.2) * u;
    const loops = variant === "highlighter" ? 1 : variant === "eraser" ? 3 : 5;
    const n = 90;
    const x0 = -W * 0.12;
    const x1 = W * 1.12;
    const path: SweepElement["path"] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t;
      // Scribble zig-zags hard, eraser rubs back and forth, highlighter is a nearly straight swipe.
      const y = cy + (Math.sin(t * Math.PI * 2 * loops + (seed % 7)) + (variant === "scribble" ? 0.55 * Math.sin(t * Math.PI * 2 * loops * 2.7 + 1.3) : 0)) * amp * (variant === "scribble" ? 3.2 : 1) + (t - 0.5) * u * 2;
      path.push({ x: rightToLeft ? W - x : x, y });
    }
    sweeps.push({
      id: `sweep:${i}`,
      kind: "sweep",
      variant,
      start,
      duration: frames,
      seed,
      color: COLORS[(seed >>> 3) % COLORS.length],
      path,
      thickness: (variant === "highlighter" ? 9 : variant === "eraser" ? 10 : 1.1) * u,
    });
  });
  return sweeps;
}
