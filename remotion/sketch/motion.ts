/**
 * Shared motion vocabulary: every element settles, snaps and pops with the
 * same physics, scaled by the scene's energy (from the speaker's tone - see
 * lib/style/tone.ts). Kept subtle on purpose: it should read as "alive",
 * never as wobbly.
 */

export interface Squash {
  sx: number;
  sy: number;
}

const NONE: Squash = { sx: 1, sy: 1 };

/**
 * Follow-through after something finishes arriving: a quick, damped squash &
 * stretch that preserves volume (wider while shorter, then back), like a
 * shape that was just pressed onto the page. `since` is frames since it landed.
 */
export function settle(since: number, fps: number, energy = 1, amount = 1): Squash {
  if (since < 0) return NONE;
  const t = since / fps;
  if (t > 1.2) return NONE;
  const a = 0.045 * energy * amount * Math.exp(-t * 6.5) * Math.sin(t * Math.PI * 2 * 2.3);
  return { sx: 1 + a, sy: 1 - a * 0.8 };
}

/** Ease that overshoots its target, then comes back - the "snap" of an arrowhead or a tick. 0..1 in, ~0..1.1 out. */
export function backOut(p: number, energy = 1): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c1 = 1.25 * energy;
  const c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

/** SVG transform that scales around a point. */
export function scaleAbout(cx: number, cy: number, sx: number, sy = sx): string | undefined {
  if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return undefined;
  return `translate(${cx} ${cy}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${-cx} ${-cy})`;
}
