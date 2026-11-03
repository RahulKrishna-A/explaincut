/**
 * Pure geometry shared by the layout engine (Node, at plan time) and the
 * Remotion renderer (browser, per frame) so both agree on where text and
 * icons sit inside a node. No DOM / Node APIs in here.
 */
import type { NodeShape, Rect } from "@/types/diagramPlan";

/** Average advance width of Caveat Bold, as a fraction of font size (measured, rounded up a touch). */
export const CHAR_WIDTH_EM = 0.47;
export const LINE_HEIGHT_EM = 1.05;

export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.28;
    else if ("ilj.,:;'!|".includes(ch)) w += 0.24;
    else if ("mwMW".includes(ch)) w += 0.72;
    else if (ch >= "A" && ch <= "Z") w += 0.55;
    else w += CHAR_WIDTH_EM;
  }
  return w * fontSize;
}

/** Greedy word wrap using the estimated metrics. Long single words are kept whole. */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && estimateTextWidth(candidate, fontSize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

/**
 * Largest font (<= maxFont, >= minFont) at which `text` wraps into at most
 * `maxLines` lines that fit `box`. Returns the wrapped lines too.
 */
export function fitText(
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxFont: number,
  minFont: number,
  maxLines = 2
): { lines: string[]; fontSize: number } {
  for (let size = maxFont; size >= minFont; size -= Math.max(1, maxFont * 0.04)) {
    const lines = wrapText(text, size, maxWidth);
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, size)));
    if (lines.length <= maxLines && widest <= maxWidth && lines.length * size * LINE_HEIGHT_EM <= maxHeight) {
      return { lines, fontSize: size };
    }
  }
  const lines = wrapText(text, minFont, maxWidth).slice(0, maxLines);
  return { lines, fontSize: minFont };
}

/** Preferred width/height ratio of each node shape. */
export const SHAPE_ASPECT: Record<NodeShape, number> = {
  box: 2.2,
  pill: 2.6,
  circle: 1,
  cylinder: 0.95,
  cloud: 1.7,
  diamond: 1.6,
  doc: 0.82,
};

/** The rectangle inside a node shape where its content (icon + label) may go. */
export function contentArea(shape: NodeShape, box: Rect): Rect {
  const { x, y, w, h } = box;
  const inset = (fx: number, fyTop: number, fyBottom = fyTop): Rect => ({
    x: x + w * fx,
    y: y + h * fyTop,
    w: w * (1 - 2 * fx),
    h: h * (1 - fyTop - fyBottom),
  });
  switch (shape) {
    case "circle":
      return inset(0.16, 0.2);
    case "cylinder":
      return inset(0.1, 0.3, 0.12);
    case "cloud":
      return inset(0.18, 0.24);
    case "diamond":
      return inset(0.25, 0.27);
    case "doc":
      return inset(0.12, 0.16, 0.08);
    case "pill":
      return inset(0.12, 0.14);
    default:
      return inset(0.07, 0.12);
  }
}

export interface NodeContentLayout {
  icon?: { x: number; y: number; size: number };
  text: Rect;
}

/** Splits a node's content area between an optional icon and the label. */
export function nodeContentLayout(shape: NodeShape, box: Rect, hasIcon: boolean): NodeContentLayout {
  const area = contentArea(shape, box);
  if (!hasIcon) return { text: area };
  const wide = area.w / area.h > 1.9;
  if (wide) {
    const size = Math.min(area.h * 0.7, area.w * 0.2);
    const gap = size * 0.18;
    return {
      icon: { x: area.x, y: area.y + (area.h - size) / 2, size },
      text: { x: area.x + size + gap, y: area.y, w: area.w - size - gap, h: area.h },
    };
  }
  const size = Math.min(area.h * 0.42, area.w * 0.45);
  const gap = size * 0.1;
  return {
    icon: { x: area.x + (area.w - size) / 2, y: area.y, size },
    text: { x: area.x, y: area.y + size + gap, w: area.w, h: area.h - size - gap },
  };
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
}

/** Point where the ray from the node centre towards (tx, ty) leaves the node outline (approximate per shape). */
export function boundaryPoint(shape: NodeShape, box: Rect, tx: number, ty: number, pad = 0): { x: number; y: number } {
  const c = center(box);
  const dx = tx - c.x;
  const dy = ty - c.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  let t: number;
  if (shape === "circle" || shape === "cloud") {
    t = 1 / Math.sqrt((ux * ux) / (hw * hw) + (uy * uy) / (hh * hh));
  } else if (shape === "diamond") {
    t = 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh);
  } else {
    t = Math.min(Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity);
  }
  return { x: c.x + ux * t, y: c.y + uy * t };
}

/** Quadratic-bezier geometry of an edge between two nodes (shared so packets ride exactly on the drawn arrow). */
export function edgeCurve(
  from: Rect,
  fromShape: NodeShape,
  to: Rect,
  toShape: NodeShape,
  bend: number,
  pad: number
): { p0: { x: number; y: number }; c: { x: number; y: number }; p1: { x: number; y: number } } {
  const a = center(from);
  const b = center(to);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const ctrl = { x: mx + nx * bend * len, y: my + ny * bend * len };
  const p0 = boundaryPoint(fromShape, from, ctrl.x, ctrl.y, pad);
  const p1 = boundaryPoint(toShape, to, ctrl.x, ctrl.y, pad);
  return { p0, c: ctrl, p1 };
}

export function quadPoint(
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}
