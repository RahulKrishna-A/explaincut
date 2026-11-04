/**
 * How long the "pen" spends on each part of each element. Shared by the
 * layout step (to schedule elements on a single-pen timeline) and the
 * renderer (to split an element's frames into outline -> fill -> icon ->
 * label phases), so a compressed element just plays its phases faster.
 */
import type {
  AxesElement,
  BarElement,
  EdgeElement,
  MarkType,
  NodeElement,
  PointElement,
  SliceElement,
  TextElement,
} from "@/types/diagramPlan";
import { center } from "./geometry";

export interface Phase {
  start: number; // seconds from element start
  end: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pen speed scales with the frame so a 4K and a 576p clip feel identical. */
export function penSpeed(width: number, height: number): number {
  return Math.hypot(width, height) * 0.95;
}

function perimeter(el: NodeElement): number {
  const { w, h } = el.box;
  switch (el.shape) {
    case "circle":
    case "cloud":
      return Math.PI * (w + h) * 0.5 * (el.shape === "cloud" ? 1.35 : 1.05);
    case "cylinder":
      return 2 * h + Math.PI * w * 1.5;
    case "diamond":
      return 2 * Math.hypot(w, h);
    default:
      return 2 * (w + h);
  }
}

export interface NodePhases {
  outline: Phase;
  fill: Phase;
  icon: Phase | null;
  label: Phase;
  total: number;
}

export function nodePhases(el: Omit<NodeElement, "start" | "duration">, width: number, height: number): NodePhases {
  const outlineDur = clamp(perimeter(el as NodeElement) / penSpeed(width, height), 0.5, 1.05);
  const outline = { start: 0, end: outlineDur };
  const fill = { start: outlineDur * 0.55, end: outlineDur * 0.55 + 0.4 };
  let cursor = outlineDur * 0.92;
  let icon: Phase | null = null;
  if (el.icon) {
    icon = { start: cursor, end: cursor + 0.45 };
    cursor += 0.4;
  }
  const chars = el.lines.join("").length;
  const label = { start: cursor, end: cursor + clamp(chars / 17, 0.3, 0.95) };
  return { outline, fill, icon, label, total: Math.max(label.end, fill.end) };
}

export interface EdgePhases {
  shaft: Phase;
  head: Phase;
  label: Phase | null;
  total: number;
}

export function edgePhases(el: Omit<EdgeElement, "start" | "duration">, width: number, height: number): EdgePhases {
  const a = center(el.from);
  const b = center(el.to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const shaftDur = clamp(len / (penSpeed(width, height) * 1.1), 0.32, 0.75);
  const shaft = { start: 0, end: shaftDur };
  const head = { start: shaftDur * 0.96, end: shaftDur * 0.96 + (el.bidirectional ? 0.3 : 0.17) };
  const label = el.label ? { start: shaftDur * 0.6, end: shaftDur * 0.6 + clamp(el.label.length / 18, 0.25, 0.7) } : null;
  return { shaft, head, label, total: Math.max(head.end, label?.end ?? 0) };
}

export interface TextPhases {
  write: Phase;
  extra: Phase; // title underline, or the note's pointer arrow
  total: number;
}

export function textPhases(el: Pick<TextElement, "lines" | "variant" | "pointTo">): TextPhases {
  const chars = el.lines.join("").length;
  const write = { start: 0, end: clamp(chars / (el.variant === "title" ? 16 : 18), 0.4, 1.9) };
  const hasExtra = el.variant === "title" || !!el.pointTo;
  const extra = hasExtra ? { start: write.end * 0.85, end: write.end * 0.85 + 0.38 } : { start: write.end, end: write.end };
  return { write, extra, total: Math.max(write.end, extra.end) };
}

export const MARK_SECONDS: Record<MarkType, number> = {
  circle: 0.65,
  underline: 0.4,
  highlight: 0.45,
  check: 0.38,
  cross: 0.45,
  sparkle: 0.4,
  divider: 0.5,
  spine: 0.7,
};

export const PACKET_TRIP_SECONDS = 0.8;

/** A sticker peels on in one quick slap (it isn't pen-drawn, so it barely holds up the pen). */
export const STICKER_SECONDS = 0.5;

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const writeSeconds = (text: string | undefined) => (text ? clamp(text.length / 18, 0.22, 0.7) : 0);

export interface AxesPhases {
  card: Phase;
  yAxis: Phase;
  xAxis: Phase;
  grid: Phase;
  label: Phase | null;
  total: number;
}

export function axesPhases(el: Pick<AxesElement, "plot" | "yLabel">, width: number, height: number): AxesPhases {
  const speed = penSpeed(width, height);
  const y = clamp(el.plot.h / speed, 0.25, 0.5);
  const x = clamp(el.plot.w / speed, 0.3, 0.6);
  const card = { start: 0, end: 0.3 };
  const yAxis = { start: 0.05, end: 0.05 + y };
  const xAxis = { start: yAxis.end * 0.9, end: yAxis.end * 0.9 + x };
  const grid = { start: xAxis.end * 0.8, end: xAxis.end * 0.8 + 0.3 };
  const label = el.yLabel ? { start: yAxis.end * 0.7, end: yAxis.end * 0.7 + writeSeconds(el.yLabel) } : null;
  return { card, yAxis, xAxis, grid, label, total: Math.max(grid.end, label?.end ?? 0) };
}

export interface BarPhases {
  label: Phase;
  grow: Phase;
  fill: Phase;
  value: Phase | null;
  total: number;
}

export function barPhases(el: Pick<BarElement, "label" | "value" | "bar" | "orientation">): BarPhases {
  const label = { start: 0, end: writeSeconds(el.label) };
  const grow = { start: 0.08, end: 0.08 + 0.55 };
  const fill = { start: 0.25, end: 0.25 + 0.5 };
  const value = el.value ? { start: grow.end * 0.85, end: grow.end * 0.85 + writeSeconds(el.value) } : null;
  return { label, grow, fill, value, total: Math.max(label.end, fill.end, value?.end ?? 0) };
}

export interface PointPhases {
  label: Phase;
  segment: Phase | null;
  dot: Phase;
  value: Phase | null;
  total: number;
}

export function pointPhases(el: Pick<PointElement, "label" | "value" | "prev" | "at">, width: number, height: number): PointPhases {
  const label = { start: 0, end: writeSeconds(el.label) };
  let cursor = 0.05;
  let segment: Phase | null = null;
  if (el.prev) {
    const len = Math.hypot(el.at.x - el.prev.x, el.at.y - el.prev.y);
    segment = { start: cursor, end: cursor + clamp(len / (penSpeed(width, height) * 0.8), 0.3, 0.7) };
    cursor = segment.end * 0.95;
  }
  const dot = { start: cursor, end: cursor + 0.22 };
  const value = el.value ? { start: dot.end * 0.9, end: dot.end * 0.9 + writeSeconds(el.value) } : null;
  return { label, segment, dot, value, total: Math.max(label.end, dot.end, value?.end ?? 0) };
}

export interface SlicePhases {
  sweep: Phase;
  fill: Phase;
  leader: Phase | null;
  label: Phase;
  total: number;
}

export function slicePhases(el: Pick<SliceElement, "a0" | "a1" | "lines" | "leader">): SlicePhases {
  const sweep = { start: 0, end: clamp(((el.a1 - el.a0) / (Math.PI * 2)) * 1.4, 0.3, 0.85) };
  const fill = { start: sweep.end * 0.4, end: sweep.end + 0.25 };
  const leader = el.leader ? { start: sweep.end * 0.8, end: sweep.end * 0.8 + 0.2 } : null;
  const labelStart = (leader?.end ?? sweep.end) * 0.95;
  const label = { start: labelStart, end: labelStart + writeSeconds(el.lines.join(" ")) };
  return { sweep, fill, leader, label, total: Math.max(fill.end, label.end) };
}
