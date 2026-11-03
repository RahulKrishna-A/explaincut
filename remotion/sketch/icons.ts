/**
 * Doodle icons as pen strokes on a 24x24 grid, in the order you'd draw them.
 * Scaled + wobbled at render time so they match the hand-drawn nodes.
 */
import type { IconName } from "@/types/diagramPlan";
import { arc, rng, sketchCloud, type Pt, type Stroke } from "./rough";

const TAU = Math.PI * 2;
const poly = (...pts: Pt[]): Stroke => pts;
const rect = (x0: number, y0: number, x1: number, y1: number): Stroke => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const dot = (x: number, y: number): Stroke => [[x - 0.3, y - 0.3], [x + 0.3, y + 0.3]];
const circle = (cx: number, cy: number, r: number, start = -2.2): Stroke => arc(cx, cy, r, r, start, start + TAU * 1.02);

function star(): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 10 : 4.3;
    pts.push([12 + r * Math.cos(a), 12.5 + r * Math.sin(a)]);
  }
  return pts;
}

function heart(): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([12 + x * 0.6, 11 + y * 0.6]);
  }
  return pts;
}

const ICONS: Record<IconName, () => Stroke[]> = {
  user: () => [circle(12, 7.5, 4.2), arc(12, 21.5, 8, 8, Math.PI, TAU)],
  bot: () => [
    poly([12, 7.5], [12, 3.5]),
    circle(12, 2.6, 1),
    rect(4, 7.5, 20, 20),
    poly([9, 12], [9, 14.5]),
    poly([15, 12], [15, 14.5]),
    poly([9.5, 17.2], [14.5, 17.2]),
  ],
  database: () => [
    arc(12, 5, 8, 3, Math.PI, Math.PI * 3.05),
    [...poly([4, 5], [4, 19]), ...arc(12, 19, 8, 3, Math.PI, 0).slice(1), ...poly([20, 19], [20, 5]).slice(1)],
    arc(12, 12, 8, 3, Math.PI, 0),
  ],
  search: () => [circle(10, 10, 6.2), poly([14.6, 14.6], [21, 21])],
  chat: () => [poly([7, 16], [3, 16], [3, 4], [21, 4], [21, 16], [12, 16], [7, 21], [7, 16]), dot(8, 10), dot(12, 10), dot(16, 10)],
  doc: () => [
    poly([15, 2], [6, 2], [6, 22], [19, 22], [19, 6], [15, 2]),
    poly([15, 2], [15, 6], [19, 6]),
    poly([9, 11], [16, 11]),
    poly([9, 15], [16, 15]),
    poly([9, 19], [13, 19]),
  ],
  gear: () => {
    const teeth: Stroke[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      teeth.push(poly([12 + 7 * Math.cos(a), 12 + 7 * Math.sin(a)], [12 + 10 * Math.cos(a), 12 + 10 * Math.sin(a)]));
    }
    return [circle(12, 12, 7), circle(12, 12, 3), ...teeth];
  },
  bulb: () => [
    [[9, 17], ...arc(12, 9, 6.2, 6.2, Math.PI * 0.72, Math.PI * 2.28), [15, 17]] as Stroke,
    poly([9, 17], [15, 17]),
    poly([9.5, 19.5], [14.5, 19.5]),
    poly([10.5, 22], [13.5, 22]),
    poly([12, 17], [12, 12], [10.5, 10.5]),
  ],
  bolt: () => [poly([13.5, 2], [5, 13.5], [11.5, 13.5], [10, 22], [19, 10], [12.5, 10], [13.5, 2])],
  cloud: () => sketchCloud(2, 5, 20, 14, rng(7)).strokes,
  lock: () => [arc(12, 11, 5, 5.5, Math.PI, TAU), rect(4.5, 11, 19.5, 21.5), poly([12, 14.5], [12, 18])],
  clock: () => [circle(12, 12, 9.5), poly([12, 6.5], [12, 12], [16, 14.5])],
  globe: () => [circle(12, 12, 9.5), arc(12, 12, 4, 9.5, -Math.PI / 2, Math.PI * 1.5), poly([2.5, 12], [21.5, 12])],
  code: () => [poly([8, 6.5], [2.5, 12], [8, 17.5]), poly([16, 6.5], [21.5, 12], [16, 17.5]), poly([14, 4.5], [10, 19.5])],
  chart: () => [
    poly([3, 3], [3, 21], [21, 21]),
    poly([6.5, 21], [6.5, 14], [9.5, 14], [9.5, 21]),
    poly([11.5, 21], [11.5, 9], [14.5, 9], [14.5, 21]),
    poly([16.5, 21], [16.5, 4.5], [19.5, 4.5], [19.5, 21]),
  ],
  star: () => [star()],
  server: () => [rect(3, 3, 21, 10.5), rect(3, 13.5, 21, 21), dot(7, 6.8), dot(7, 17.3), poly([11, 6.8], [17, 6.8]), poly([11, 17.3], [17, 17.3])],
  mail: () => [rect(2, 5, 22, 19), poly([2, 5], [12, 13], [22, 5])],
  chip: () => {
    const pins: Stroke[] = [];
    for (const p of [9, 15]) {
      pins.push(poly([p, 6], [p, 2.5]), poly([p, 18], [p, 21.5]), poly([6, p], [2.5, p]), poly([18, p], [21.5, p]));
    }
    return [rect(6, 6, 18, 18), rect(9.5, 9.5, 14.5, 14.5), ...pins];
  },
  heart: () => [heart()],
};

/** Icon strokes scaled into a square at (x, y) with side `size`. */
export function iconStrokes(name: IconName, x: number, y: number, size: number): Stroke[] {
  const k = size / 24;
  return ICONS[name]().map((s) => s.map(([px, py]) => [x + px * k, y + py * k] as Pt));
}
