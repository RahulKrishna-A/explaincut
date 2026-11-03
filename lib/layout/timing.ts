/**
 * How long the "pen" spends on each part of each element. Shared by the
 * layout step (to schedule elements on a single-pen timeline) and the
 * renderer (to split an element's frames into outline -> fill -> icon ->
 * label phases), so a compressed element just plays its phases faster.
 */
import type { EdgeElement, MarkType, NodeElement, TextElement } from "@/types/diagramPlan";
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
};

export const PACKET_TRIP_SECONDS = 0.8;
