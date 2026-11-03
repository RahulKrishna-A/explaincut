/**
 * Tiny hand-drawn stroke engine.
 *
 * Every shape is generated as one or more polylines ("strokes") in the order
 * a person would draw them - a circle starts at the upper-left and sweeps
 * clockwise past its start, a box is traced in one go with an overshoot at
 * the end. `partial()` then reveals exactly the first N% of that pen path, so
 * any shape can be "drawn live" at any frame, deterministically (seeded).
 */

export type Pt = [number, number];
export type Stroke = Pt[];
export type Rand = () => number;

/** mulberry32 - small, fast, deterministic. */
export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const between = (r: Rand, a: number, b: number) => a + (b - a) * r();
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A slightly bowed, slightly jittered straight line - the core of the hand-drawn look. */
export function handLine(a: Pt, b: Pt, r: Rand, bow = 0.02, jitter = 0): Stroke {
  const len = dist(a, b);
  const n = Math.max(6, Math.ceil(len / 6));
  const nx = -(b[1] - a[1]) / (len || 1);
  const ny = (b[0] - a[0]) / (len || 1);
  const off = between(r, -1, 1) * bow * len;
  const a2: Pt = [a[0] + between(r, -jitter, jitter), a[1] + between(r, -jitter, jitter)];
  const b2: Pt = [b[0] + between(r, -jitter, jitter), b[1] + between(r, -jitter, jitter)];
  const c: Pt = [(a2[0] + b2[0]) / 2 + nx * off, (a2[1] + b2[1]) / 2 + ny * off];
  return quad(a2, c, b2, n);
}

export function quad(p0: Pt, c: Pt, p1: Pt, n = 24): Stroke {
  const out: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n?: number): Stroke {
  const steps = n ?? Math.max(8, Math.ceil((Math.abs(a1 - a0) * Math.max(rx, ry)) / 5));
  const out: Stroke = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Resamples a stroke so no segment is longer than `step` px (needed before wobble/boil on sparse polylines). */
export function densify(stroke: Stroke, step: number): Stroke {
  if (stroke.length < 2) return stroke;
  const out: Stroke = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Low-frequency wobble along a stroke's normal, so long lines aren't ruler-straight. */
export function wobble(stroke: Stroke, amp: number, r: Rand): Stroke {
  if (stroke.length < 3 || amp <= 0) return stroke;
  const f1 = between(r, 0.6, 1.6);
  const f2 = between(r, 2.2, 4);
  const p1 = between(r, 0, TAU);
  const p2 = between(r, 0, TAU);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < stroke.length; i++) cum.push((total += dist(stroke[i - 1], stroke[i])));
  return stroke.map((p, i) => {
    const prev = stroke[Math.max(0, i - 1)];
    const next = stroke[Math.min(stroke.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const l = Math.hypot(dx, dy) || 1;
    const t = total > 0 ? cum[i] / total : 0;
    const o = amp * (0.7 * Math.sin(TAU * f1 * t + p1) + 0.3 * Math.sin(TAU * f2 * t + p2));
    return [p[0] - (dy / l) * o, p[1] + (dx / l) * o];
  });
}

/**
 * "Line boil": the subtle frame-to-frame shimmer of hand-animated lines.
 * Changes only every few frames (like drawings on 2s/3s), tiny amplitude.
 */
export function boil(stroke: Stroke, frame: number, amp: number, seed: number): Stroke {
  if (amp <= 0) return stroke;
  const phase = Math.floor(frame / 4) * 1.913 + (seed % 97);
  return stroke.map((p, i) => [p[0] + amp * Math.sin(i * 0.73 + phase), p[1] + amp * Math.cos(i * 0.61 + phase * 1.3)]);
}

// ---------------------------------------------------------------------------
// Shapes. Each returns the strokes in drawing order + a polygon for fills.
// ---------------------------------------------------------------------------

export interface Shape {
  strokes: Stroke[];
  fill: Pt[];
}

function rotateAll(strokes: Stroke[], cx: number, cy: number, angle: number): Stroke[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return strokes.map((st) => st.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as Pt));
}

/** One continuous stroke around a (rounded) rectangle, starting top-left, ending past the start. */
export function sketchRect(x: number, y: number, w: number, h: number, radius: number, r: Rand): Shape {
  const rad = Math.min(radius, w / 2, h / 2);
  const j = Math.min(w, h) * 0.015;
  const bow = 0.012;
  const pts: Stroke = [];
  const push = (s: Stroke) => pts.push(...(pts.length ? s.slice(1) : s));
  const startX = x + rad + w * between(r, 0.04, 0.12);
  push(handLine([startX, y], [x + w - rad, y], r, bow, j));
  push(arc(x + w - rad, y + rad, rad, rad, -Math.PI / 2, 0, 6));
  push(handLine([x + w, y + rad], [x + w, y + h - rad], r, bow, j));
  push(arc(x + w - rad, y + h - rad, rad, rad, 0, Math.PI / 2, 6));
  push(handLine([x + w - rad, y + h], [x + rad, y + h], r, bow, j));
  push(arc(x + rad, y + h - rad, rad, rad, Math.PI / 2, Math.PI, 6));
  push(handLine([x, y + h - rad], [x, y + rad], r, bow, j));
  push(arc(x + rad, y + rad, rad, rad, Math.PI, Math.PI * 1.5, 6));
  // Overshoot: the pen runs a little past where it started.
  const over = Math.min(w * between(r, 0.08, 0.16), w * 0.5);
  push(handLine([x + rad, y], [startX + over, y + between(r, -1, 1) * j * 2], r, bow * 0.5));
  const angle = between(r, -0.012, 0.012);
  const strokes = rotateAll([pts], x + w / 2, y + h / 2, angle);
  return { strokes, fill: strokes[0] };
}

/**
 * A hand-drawn ellipse: begins at the upper-left, sweeps clockwise (left to
 * right across the top, like a right hand draws), overshoots its start and
 * spirals out slightly so the overlap is visible.
 */
export function sketchEllipse(cx: number, cy: number, rx: number, ry: number, r: Rand, turns = 1.08): Shape {
  const start = between(r, -2.5, -2.0);
  const spiral = between(r, 0.03, 0.07);
  const ph = between(r, 0, TAU);
  const n = Math.max(32, Math.ceil((Math.PI * (rx + ry) * turns) / 5));
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * TAU * turns;
    const f = 1 + spiral * (t - 0.5) + 0.022 * Math.sin(3 * a + ph);
    pts.push([cx + rx * f * Math.cos(a), cy + ry * f * Math.sin(a)]);
  }
  return { strokes: [pts], fill: arc(cx, cy, rx, ry, 0, TAU, 48) };
}

export function sketchDiamond(x: number, y: number, w: number, h: number, r: Rand): Shape {
  const t: Pt = [x + w / 2, y];
  const rt: Pt = [x + w, y + h / 2];
  const b: Pt = [x + w / 2, y + h];
  const l: Pt = [x, y + h / 2];
  const j = Math.min(w, h) * 0.015;
  const pts: Stroke = [];
  for (const [p, q] of [[t, rt], [rt, b], [b, l], [l, t]] as [Pt, Pt][]) {
    const s = handLine(p, q, r, 0.015, j);
    pts.push(...(pts.length ? s.slice(1) : s));
  }
  const over: Pt = [t[0] + (rt[0] - t[0]) * 0.15, t[1] + (rt[1] - t[1]) * 0.15];
  pts.push(...handLine(t, over, r, 0.01).slice(1));
  return { strokes: [pts], fill: [t, rt, b, l] };
}

export function sketchCylinder(x: number, y: number, w: number, h: number, r: Rand): Shape {
  const ry = Math.min(h * 0.14, w * 0.22);
  const cx = x + w / 2;
  const top = sketchEllipse(cx, y + ry, w / 2, ry, r, 1.04).strokes[0];
  const left = handLine([x, y + ry], [x, y + h - ry], r, 0.01);
  const bottom = arc(cx, y + h - ry, w / 2, ry, Math.PI, 0);
  const right = handLine([x + w, y + h - ry], [x + w, y + ry], r, 0.01);
  const fill = [...arc(cx, y + ry, w / 2, ry, Math.PI, TAU, 16), ...arc(cx, y + h - ry, w / 2, ry, 0, Math.PI, 16)];
  return { strokes: [top, [...left, ...bottom.slice(1), ...right.slice(1)]], fill };
}

export function sketchCloud(x: number, y: number, w: number, h: number, r: Rand): Shape {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = (w / 2) * 0.8;
  const ry = (h / 2) * 0.68;
  const bumps = 9;
  const start = -Math.PI * 0.85;
  const pts: Stroke = [];
  for (let k = 0; k < bumps; k++) {
    const a0 = start + (k / bumps) * TAU;
    const a1 = start + ((k + 1) / bumps) * TAU;
    const p0: Pt = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)];
    const p1: Pt = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
    const chord = dist(p0, p1);
    const hgt = chord * between(r, 0.38, 0.55);
    const am = (a0 + a1) / 2;
    const steps = 10;
    for (let i = k === 0 ? 0 : 1; i <= steps; i++) {
      const s = i / steps;
      const bx = p0[0] + (p1[0] - p0[0]) * s;
      const by = p0[1] + (p1[1] - p0[1]) * s;
      const out = Math.sin(Math.PI * s) * hgt;
      pts.push([bx + Math.cos(am) * out, by + Math.sin(am) * out]);
    }
  }
  pts.push(...pts.slice(1, 4));
  return { strokes: [pts], fill: pts };
}

export function sketchDoc(x: number, y: number, w: number, h: number, r: Rand): Shape {
  const fold = Math.min(w, h) * 0.24;
  const j = Math.min(w, h) * 0.012;
  const corners: Pt[] = [[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h], [x, y]];
  const outline: Stroke = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const s = handLine(corners[i], corners[i + 1], r, 0.012, j);
    outline.push(...(outline.length ? s.slice(1) : s));
  }
  const foldStroke = [...handLine([x + w - fold, y], [x + w - fold, y + fold], r, 0.02), ...handLine([x + w - fold, y + fold], [x + w, y + fold], r, 0.02).slice(1)];
  return { strokes: [outline, foldStroke], fill: corners };
}

/** Rough.js-style zigzag hachure covering a box (clip it to the shape). One continuous stroke. */
export function hachure(x: number, y: number, w: number, h: number, gap: number, r: Rand, angle = -0.85): Stroke {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const diag = Math.hypot(w, h) / 2 + gap;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const pts: Stroke = [];
  let i = 0;
  for (let o = -diag; o <= diag; o += gap * between(r, 0.85, 1.15), i++) {
    const ax = cx + px * o - dx * diag;
    const ay = cy + py * o - dy * diag;
    const bx = cx + px * o + dx * diag;
    const by = cy + py * o + dy * diag;
    if (i % 2 === 0) pts.push([ax, ay], [bx, by]);
    else pts.push([bx, by], [ax, ay]);
  }
  return pts;
}

/** A "V" arrowhead drawn in one flick, pointing along `angle` with the tip at `tip`. */
export function arrowHead(tip: Pt, angle: number, size: number, r: Rand): Stroke {
  const spread = between(r, 0.42, 0.52);
  const l: Pt = [tip[0] - size * Math.cos(angle - spread), tip[1] - size * Math.sin(angle - spread)];
  const rr: Pt = [tip[0] - size * Math.cos(angle + spread), tip[1] - size * Math.sin(angle + spread)];
  return [...handLine(l, tip, r, 0.04), ...handLine(tip, rr, r, 0.04).slice(1)];
}

// ---------------------------------------------------------------------------
// Partial reveal
// ---------------------------------------------------------------------------

/** Mostly-linear pen speed with a soft start/stop for each stroke. */
function penEase(u: number): number {
  return u * 0.55 + (0.5 - 0.5 * Math.cos(Math.PI * u)) * 0.45;
}

function strokeLength(s: Stroke): number {
  let l = 0;
  for (let i = 1; i < s.length; i++) l += dist(s[i - 1], s[i]);
  return l;
}

/** The first `amount` (0..1) of a single stroke, plus the pen position. */
function cutStroke(s: Stroke, amount: number): { pts: Stroke; tip: Pt } {
  if (amount >= 1) return { pts: s, tip: s[s.length - 1] };
  const target = strokeLength(s) * amount;
  const pts: Stroke = [s[0]];
  let acc = 0;
  for (let i = 1; i < s.length; i++) {
    const seg = dist(s[i - 1], s[i]);
    if (acc + seg >= target) {
      const k = seg > 0 ? (target - acc) / seg : 0;
      const p: Pt = [s[i - 1][0] + (s[i][0] - s[i - 1][0]) * k, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k];
      pts.push(p);
      return { pts, tip: p };
    }
    acc += seg;
    pts.push(s[i]);
  }
  return { pts, tip: s[s.length - 1] };
}

export function toPath(s: Stroke): string {
  if (s.length === 0) return "";
  let d = `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}`;
  for (let i = 1; i < s.length; i++) d += `L${s[i][0].toFixed(1)} ${s[i][1].toFixed(1)}`;
  return d;
}

/**
 * Reveals the strokes in order up to `progress` (0..1). Pen-lift time between
 * strokes is modelled so multi-stroke shapes pause naturally between strokes.
 */
export function partial(strokes: Stroke[], progress: number): { d: string; tip: Pt | null } {
  if (progress <= 0 || strokes.length === 0) return { d: "", tip: null };
  const lengths = strokes.map(strokeLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const lift = strokes.length > 1 ? (total * 0.06) : 0;
  const timeline = total + lift * (strokes.length - 1);
  let t = Math.min(1, progress) * timeline;
  let d = "";
  let tip: Pt | null = null;
  for (let i = 0; i < strokes.length; i++) {
    const len = lengths[i];
    if (t <= 0) break;
    if (t >= len) {
      d += toPath(strokes[i]);
      tip = strokes[i][strokes[i].length - 1];
      t -= len + lift;
      continue;
    }
    const cut = cutStroke(strokes[i], penEase(t / (len || 1)));
    d += toPath(cut.pts);
    tip = cut.tip;
    t = 0;
    break;
  }
  return { d, tip: progress >= 1 ? null : tip };
}
