/**
 * Turns a timing-resolved plan into a RenderPlan: every node placed (in
 * pixels) inside the free space around the speaker, and every element given
 * a start frame + duration on a single-pen timeline, so drawing looks like
 * one hand sketching along with the speech rather than assets popping in.
 *
 * Pure TypeScript - runs in Node (pipeline) and in the Remotion preview.
 */
import type {
  Accent,
  AxesElement,
  BarElement,
  DiagramNode,
  EdgeElement,
  FreeRegion,
  FreeSpace,
  MarkElement,
  MarkType,
  NodeElement,
  NodeShape,
  PointElement,
  Rect,
  RenderElement,
  RenderPlan,
  RenderScene,
  ResolvedDiagramPlan,
  ResolvedDiagramScene,
  SliceElement,
  StickerAssets,
  RenderStyle,
} from "@/types/diagramPlan";
import { legacyStickerKey, stickerKey } from "./stickerKey";
import { toneProfile } from "@/lib/style/tone";
import { buildSweeps } from "./buildSweeps";
import { buildKeywords } from "./buildKeywords";
import {
  SHAPE_ASPECT,
  center,
  edgeCurve,
  estimateTextWidth,
  quadPoint,
  fitText,
  inflate,
  nodeContentLayout,
  overlaps,
  wrapText,
  LINE_HEIGHT_EM,
} from "./geometry";
import {
  MARK_SECONDS,
  PACKET_TRIP_SECONDS,
  STICKER_SECONDS,
  axesPhases,
  barPhases,
  edgePhases,
  nodePhases,
  pointPhases,
  slicePhases,
  textPhases,
} from "./timing";
import { layoutChart, type ChartLayout } from "./chartLayout";

const nodeById0 = (scene: ResolvedDiagramScene, id: string): NodeShape => scene.nodes.find((n) => n.id === id)?.shape ?? "box";

const NODE_PALETTE: Accent[] = ["blue", "pink", "green", "orange", "purple"];
const MARK_COLOR: Record<MarkType, Accent> = {
  circle: "pink",
  underline: "orange",
  highlight: "yellow",
  check: "green",
  cross: "pink",
  sparkle: "yellow",
  divider: "purple",
  spine: "purple",
};

/** Start drawing a hair before the word lands - reads as "in sync" to viewers. */
const LEAD_SECONDS = 0.12;
/** How far the single pen may fall behind the speech before we let two things draw at once. */
const MAX_PEN_DELAY_SECONDS = 0.9;
const ERASE_SECONDS = 0.45;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const area = (r: Rect) => r.w * r.h;
const SIDE_ORDER: Record<FreeRegion["side"], number> = { top: 0, left: 1, center: 2, right: 3, bottom: 4 };
const readingOrder = (a: FreeRegion, b: FreeRegion) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.x - b.x || a.y - b.y;

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

interface Ctx {
  W: number;
  H: number;
  u: number; // 1% of the short side
}

function minCell(ctx: Ctx) {
  return { w: ctx.u * 19, h: ctx.u * 9 };
}

function capacity(region: Rect, ctx: Ctx): number {
  const m = minCell(ctx);
  return Math.max(0, Math.floor(region.w / m.w)) * Math.max(0, Math.floor(region.h / m.h));
}

function chooseGrid(region: Rect, n: number, aspect: number, ctx: Ctx): { rows: number; cols: number } {
  let best = { rows: 1, cols: n };
  let bestScore = Infinity;
  const m = minCell(ctx);
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const cw = region.w / cols;
    const ch = region.h / rows;
    let score = Math.abs(Math.log(cw / ch / (aspect * 1.25)));
    score += (rows * cols - n) * 0.25;
    score += (rows - 1) * 0.55; // flows read best left-to-right
    if (cw < m.w) score += 3 * (m.w / cw);
    if (ch < m.h) score += 3 * (m.h / ch);
    if (score < bestScore) {
      bestScore = score;
      best = { rows, cols };
    }
  }
  return best;
}

/** Cells in "snake" order (row 0 L->R, row 1 R->L, ...) so consecutive flow steps stay adjacent. */
function snakeCells(region: Rect, rows: number, cols: number, n: number): Rect[] {
  const cw = region.w / cols;
  const ch = region.h / rows;
  const cells: Rect[] = [];
  for (let r = 0; r < rows && cells.length < n; r++) {
    const inRow = Math.min(cols, n - cells.length);
    // Centre a partially-filled last row.
    const offset = r === rows - 1 ? ((cols - inRow) * cw) / 2 : 0;
    for (let i = 0; i < inRow; i++) {
      const c = r % 2 === 0 ? i : inRow - 1 - i;
      cells.push({ x: region.x + offset + c * cw, y: region.y + r * ch, w: cw, h: ch });
    }
  }
  return cells;
}

function columnCells(region: Rect, n: number): Rect[] {
  const ch = region.h / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ x: region.x, y: region.y + i * ch, w: region.w, h: ch }));
}

/** Fit a node of the given shape centred inside a cell. */
/** How far a non-box shape may stretch beyond its preferred aspect to use a wide cell (drums, ovals and clouds still read fine). */
const STRETCH: Record<NodeShape, number> = { box: 1, pill: 1, circle: 1.35, cylinder: 1.8, cloud: 1.4, diamond: 1.35, doc: 1.15 };

function boxInCell(cell: Rect, shape: NodeShape, ctx: Ctx, aspectOverride?: number): Rect {
  const maxW = Math.min(cell.w * 0.86, ctx.u * 42);
  const maxH = Math.min(cell.h * 0.8, ctx.u * 30);
  const preferred = aspectOverride ?? SHAPE_ASPECT[shape];
  const aspect = aspectOverride ? preferred : Math.max(preferred / STRETCH[shape], Math.min(preferred * STRETCH[shape], maxW / maxH));
  let w = Math.min(maxW, maxH * aspect);
  let h = w / aspect;
  if (shape === "box" || shape === "pill") {
    // Boxes take the cell's full width - room for big, readable handwriting.
    w = maxW;
    h = Math.min(maxH, Math.max(w / (aspect * 1.2), ctx.u * 12));
  }
  w = Math.max(w, Math.min(maxW, ctx.u * 12));
  return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

interface SceneGeometry {
  boxes: Map<string, Rect>;
  title?: { lines: string[]; fontSize: number; x: number; y: number; blockWidth: number };
  divider?: Rect;
  spine?: { rect: Rect; ticks: { x: number; y: number }[] };
  chart?: ChartLayout;
  occupied: Rect[];
}

function regionsForFlow(n: number, regions: FreeRegion[], ctx: Ctx): { region: FreeRegion; count: number }[] {
  const [primary, ...rest] = regions;
  const caps = regions.map((r) => capacity(r, ctx));
  const used: FreeRegion[] = [primary];
  const secondBalanced =
    rest[0] && n >= 3 && area(rest[0]) >= area(primary) * 0.6 && rest[0].side !== primary.side && caps[1] > 0;
  if (secondBalanced) used.push(rest[0]);
  let total = used.reduce((s, r) => s + capacity(r, ctx), 0);
  for (const r of rest) {
    if (total >= n) break;
    if (used.includes(r) || capacity(r, ctx) === 0) continue;
    used.push(r);
    total += capacity(r, ctx);
  }
  used.sort(readingOrder);

  // Share nodes in proportion to area, at least one each, within capacity.
  const totalArea = used.reduce((s, r) => s + area(r), 0);
  const counts = used.map((r) => Math.max(1, Math.round((n * area(r)) / totalArea)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < 100; i++) {
    const idx = i % used.length;
    if (diff > 0) {
      counts[idx]++;
      diff--;
    } else if (counts[idx] > 1) {
      counts[idx]--;
      diff++;
    }
  }
  return used.map((region, i) => ({ region, count: counts[i] })).filter((x) => x.count > 0);
}

function layoutFlow(nodes: DiagramNode[], regions: FreeRegion[], ctx: Ctx, forceRows?: number): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  const shapeOf = (n: DiagramNode) => n.shape ?? "box";
  const aspect = Math.max(...nodes.map((n) => SHAPE_ASPECT[shapeOf(n)]));
  let i = 0;
  for (const { region, count } of regionsForFlow(nodes.length, regions, ctx)) {
    const grid = forceRows
      ? { rows: Math.min(forceRows, count), cols: Math.ceil(count / Math.min(forceRows, count)) }
      : chooseGrid(region, count, aspect, ctx);
    const cells = snakeCells(region, grid.rows, grid.cols, count);
    for (const cell of cells) {
      const node = nodes[i++];
      if (!node) break;
      boxes.set(node.id, boxInCell(cell, shapeOf(node), ctx));
    }
  }
  return boxes;
}

function layoutHub(scene: ResolvedDiagramScene, region: Rect, ctx: Ctx): Map<string, Rect> | null {
  const nodes = scene.nodes;
  if (nodes.length < 2) return null;
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of scene.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const hub = nodes.reduce((a, b) => ((degree.get(b.id) ?? 0) > (degree.get(a.id) ?? 0) ? b : a));
  const sats = nodes.filter((n) => n !== hub);
  if (sats.length > 6) return null;

  const boxes = new Map<string, Rect>();
  const wide = region.w / region.h >= 1.25;
  const firstHalf = sats.slice(0, Math.ceil(sats.length / 2));
  const secondHalf = sats.slice(Math.ceil(sats.length / 2));
  if (wide) {
    const sideW = region.w * 0.33;
    const left: Rect = { x: region.x, y: region.y, w: sideW, h: region.h };
    const right: Rect = { x: region.x + region.w - sideW, y: region.y, w: sideW, h: region.h };
    const mid: Rect = { x: region.x + sideW, y: region.y, w: region.w - 2 * sideW, h: region.h };
    columnCells(left, firstHalf.length).forEach((c, i) => boxes.set(firstHalf[i].id, boxInCell(c, firstHalf[i].shape ?? "box", ctx)));
    columnCells(right, secondHalf.length).forEach((c, i) => boxes.set(secondHalf[i].id, boxInCell(c, secondHalf[i].shape ?? "box", ctx)));
    const hubCellH = Math.min(mid.h, (region.h / Math.max(1, firstHalf.length)) * 1.5);
    boxes.set(hub.id, boxInCell({ ...mid, y: mid.y + (mid.h - hubCellH) / 2, h: hubCellH }, hub.shape ?? "circle", ctx));
  } else {
    const bandH = region.h * 0.33;
    const top: Rect = { x: region.x, y: region.y, w: region.w, h: bandH };
    const bottom: Rect = { x: region.x, y: region.y + region.h - bandH, w: region.w, h: bandH };
    const mid: Rect = { x: region.x, y: region.y + bandH, w: region.w, h: region.h - 2 * bandH };
    const row = (r: Rect, ns: DiagramNode[]) =>
      ns.forEach((n, i) => boxes.set(n.id, boxInCell({ x: r.x + (i * r.w) / ns.length, y: r.y, w: r.w / ns.length, h: r.h }, n.shape ?? "box", ctx)));
    row(top, firstHalf);
    row(bottom, secondHalf);
    boxes.set(hub.id, boxInCell(mid, hub.shape ?? "circle", ctx));
  }
  return boxes;
}

function layoutStack(nodes: DiagramNode[], region: Rect, ctx: Ctx): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  const cols = region.h / nodes.length < ctx.u * 8 ? 2 : 1;
  const perCol = Math.ceil(nodes.length / cols);
  nodes.forEach((n, i) => {
    const c = Math.floor(i / perCol);
    const r = i % perCol;
    const cell = { x: region.x + (c * region.w) / cols, y: region.y + (r * region.h) / perCol, w: region.w / cols, h: region.h / perCol };
    boxes.set(n.id, boxInCell(cell, n.shape ?? "box", ctx, Math.max(3.2, SHAPE_ASPECT[n.shape ?? "box"])));
  });
  return boxes;
}

function layoutCycle(nodes: DiagramNode[], regions: FreeRegion[], ctx: Ctx): Map<string, Rect> {
  const region = regions[0];
  const aspect = region.w / region.h;
  if (nodes.length < 3 || aspect > 1.9 || aspect < 0.5) {
    // A two-row snake *is* a ring: top row left->right, bottom row right->left.
    return layoutFlow(nodes, [region], ctx, nodes.length >= 3 ? 2 : 1);
  }
  const boxes = new Map<string, Rect>();
  const div = nodes.length <= 4 ? 2.3 : 2.8;
  const cell = { w: region.w / div, h: region.h / div };
  const c = center(region);
  const rx = region.w / 2 - cell.w / 2;
  const ry = region.h / 2 - cell.h / 2;
  nodes.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
    const cx = c.x + rx * Math.cos(a);
    const cy = c.y + ry * Math.sin(a);
    boxes.set(n.id, boxInCell({ x: cx - cell.w / 2, y: cy - cell.h / 2, w: cell.w, h: cell.h }, n.shape ?? "box", ctx));
  });
  return boxes;
}

function layoutCompare(nodes: DiagramNode[], regions: FreeRegion[], ctx: Ctx): { boxes: Map<string, Rect>; divider?: Rect } {
  const a: DiagramNode[] = [];
  const b: DiagramNode[] = [];
  nodes.forEach((n, i) => (n.group === "a" ? a : n.group === "b" ? b : i % 2 === 0 ? a : b).push(n));

  const primary = regions[0];
  const leftR = regions.find((r) => r.side === "left" && area(r) >= area(primary) * 0.35);
  const rightR = regions.find((r) => r.side === "right" && area(r) >= area(primary) * 0.35);
  let sideA: Rect;
  let sideB: Rect;
  let divider: Rect | undefined;
  if (leftR && rightR) {
    sideA = leftR;
    sideB = rightR;
  } else {
    const gutter = ctx.u * 5;
    if (primary.w >= primary.h) {
      const half = (primary.w - gutter) / 2;
      sideA = { x: primary.x, y: primary.y, w: half, h: primary.h };
      sideB = { x: primary.x + half + gutter, y: primary.y, w: half, h: primary.h };
      divider = { x: primary.x + half + gutter / 2, y: primary.y + primary.h * 0.04, w: 0, h: primary.h * 0.92 };
    } else {
      const half = (primary.h - gutter) / 2;
      sideA = { x: primary.x, y: primary.y, w: primary.w, h: half };
      sideB = { x: primary.x, y: primary.y + half + gutter, w: primary.w, h: half };
      divider = { x: primary.x + primary.w * 0.04, y: primary.y + half + gutter / 2, w: primary.w * 0.92, h: 0 };
    }
  }
  const boxes = new Map<string, Rect>();
  const place = (side: Rect, ns: DiagramNode[]) => {
    if (ns.length === 0) return;
    const grid = chooseGrid(side, ns.length, SHAPE_ASPECT[ns[0].shape ?? "box"], ctx);
    snakeCells(side, grid.rows, grid.cols, ns.length).forEach((cell, i) => boxes.set(ns[i].id, boxInCell(cell, ns[i].shape ?? "box", ctx)));
  };
  place(sideA, a);
  place(sideB, b);
  return { boxes, divider };
}

/**
 * Hierarchy: roots on top, children fanned out below (or left-to-right when
 * the space is wide and short and the tree is deep). Parents sit centred
 * over their children - a classic tidy tree.
 */
function layoutTree(scene: ResolvedDiagramScene, region: Rect, ctx: Ctx): Map<string, Rect> | null {
  const nodes = scene.nodes;
  if (nodes.length < 2) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const hasParent = new Set<string>();
  for (const e of scene.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || hasParent.has(e.to) || e.to === e.from) continue;
    children.get(e.from)!.push(e.to);
    hasParent.add(e.to);
  }
  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  if (roots.length === 0) roots.push(nodes[0].id);

  // Leaves get consecutive slots; a parent is centred over its children.
  const depth = new Map<string, number>();
  const slot = new Map<string, number>();
  let nextLeaf = 0;
  const visit = (id: string, d: number): number => {
    depth.set(id, d);
    const kids = children.get(id)!.filter((k) => !depth.has(k));
    if (kids.length === 0) {
      slot.set(id, nextLeaf);
      return nextLeaf++;
    }
    const xs = kids.map((k) => visit(k, d + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    slot.set(id, x);
    return x;
  };
  for (const r of roots) if (!depth.has(r)) visit(r, 0);
  for (const n of nodes) if (!depth.has(n.id)) visit(n.id, 0);

  const levels = Math.max(...depth.values()) + 1;
  const breadth = Math.max(1, nextLeaf);
  const m = minCell(ctx);
  const aspect = Math.max(...nodes.map((n) => SHAPE_ASPECT[n.shape ?? "box"]));
  // Score = how big a node of the preferred aspect can get in each orientation.
  const fitScore = (cw: number, ch: number) => Math.min(cw / aspect, ch) * (cw < m.w * 0.8 || ch < m.h * 0.8 ? 0.5 : 1);
  const down = fitScore(region.w / breadth, region.h / levels);
  const right = fitScore(region.w / levels, region.h / breadth);
  const vertical = down >= right * 0.9;

  const boxes = new Map<string, Rect>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    const s = slot.get(n.id)!;
    const cell = vertical
      ? { w: region.w / breadth, h: region.h / levels, x: region.x + (region.w / breadth) * s, y: region.y + (region.h / levels) * d }
      : { w: region.w / levels, h: region.h / breadth, x: region.x + (region.w / levels) * d, y: region.y + (region.h / breadth) * s };
    // Parents may stretch wider than one leaf slot - their row has room.
    const kids = children.get(n.id)!.length;
    const grow = vertical && kids > 1 ? Math.min(kids, 2) : 1;
    const wide = { ...cell, x: cell.x - (cell.w * (grow - 1)) / 2, w: cell.w * grow };
    const clipped = { ...wide, x: Math.max(region.x, wide.x), w: Math.min(region.x + region.w, wide.x + wide.w) - Math.max(region.x, wide.x) };
    // Leave a real gap between levels so the parent -> child arrows have room to read.
    const gapped = vertical
      ? { ...clipped, y: clipped.y + clipped.h * 0.16, h: clipped.h * 0.68 }
      : { ...clipped, x: clipped.x + clipped.w * 0.14, w: clipped.w * 0.72 };
    boxes.set(n.id, boxInCell(gapped, n.shape ?? "box", ctx));
  }
  return boxes;
}

/** Events along a hand-drawn time arrow, alternating either side of it when there's room. */
function layoutTimeline(
  nodes: DiagramNode[],
  region: Rect,
  ctx: Ctx
): { boxes: Map<string, Rect>; spine: Rect; ticks: { x: number; y: number }[] } {
  const n = Math.max(1, nodes.length);
  const boxes = new Map<string, Rect>();
  const ticks: { x: number; y: number }[] = [];
  const gap = ctx.u * 1.5;
  if (region.w >= region.h) {
    const alternate = region.h >= ctx.u * 24 && n > 1;
    const spineY = alternate ? region.y + region.h / 2 : region.y + region.h - ctx.u * 2;
    const slot = region.w / n;
    nodes.forEach((node, i) => {
      const cx = region.x + slot * (i + 0.5);
      ticks.push({ x: cx, y: spineY });
      const above = !alternate || i % 2 === 0;
      const cw = alternate ? Math.min(slot * 1.8, region.w) : slot;
      const cell = {
        x: clamp(cx - cw / 2, region.x, region.x + region.w - cw),
        y: above ? region.y : spineY + gap,
        w: cw,
        h: above ? spineY - gap - region.y : region.y + region.h - spineY - gap,
      };
      boxes.set(node.id, boxInCell(cell, node.shape ?? "pill", ctx));
    });
    return { boxes, spine: { x: region.x + ctx.u, y: spineY, w: region.w - ctx.u * 2, h: 0 }, ticks };
  }
  const alternate = region.w >= ctx.u * 44 && n > 1;
  const spineX = alternate ? region.x + region.w / 2 : region.x + ctx.u * 2.5;
  const slot = region.h / n;
  nodes.forEach((node, i) => {
    const cy = region.y + slot * (i + 0.5);
    ticks.push({ x: spineX, y: cy });
    const leftSide = alternate && i % 2 === 1;
    const ch = alternate ? Math.min(slot * 1.6, region.h) : slot;
    const cell = {
      x: leftSide ? region.x : spineX + gap,
      y: clamp(cy - ch / 2, region.y, region.y + region.h - ch),
      w: leftSide ? spineX - gap - region.x : region.x + region.w - spineX - gap,
      h: ch,
    };
    boxes.set(node.id, boxInCell(cell, node.shape ?? "pill", ctx));
  });
  return { boxes, spine: { x: spineX, y: region.y + ctx.u, w: 0, h: region.h - ctx.u * 2 }, ticks };
}

function layoutScene(scene: ResolvedDiagramScene, space: FreeSpace, ctx: Ctx, seedBase: number): SceneGeometry {
  const regions = space.regions.map((r) => ({ ...r }));
  const occupied: Rect[] = [];
  let title: SceneGeometry["title"];

  const titleOp = scene.ops.find((o) => o.type === "title" && o.text);
  // The heading goes where the eye starts reading: the first substantial region in reading order.
  const titleRegion = regions.filter((r) => area(r) >= area(regions[0]) * 0.5).sort(readingOrder)[0];
  const ti = titleRegion ? regions.indexOf(titleRegion) : -1;
  if (titleOp?.text && ti >= 0) {
    const p = regions[ti];
    const maxFont = clamp(ctx.u * 6, 18, 90);
    const fit = fitText(titleOp.text, p.w * 0.94, p.h * 0.3, maxFont, maxFont * 0.55, 2);
    const blockWidth = Math.max(...fit.lines.map((l) => estimateTextWidth(l, fit.fontSize)));
    const blockH = fit.lines.length * fit.fontSize * LINE_HEIGHT_EM + ctx.u * 2.4;
    title = { ...fit, x: p.x + (p.w - blockWidth) / 2, y: p.y, blockWidth };
    occupied.push({ x: title.x, y: p.y, w: blockWidth, h: blockH });
    regions[ti] = { ...p, y: p.y + blockH, h: p.h - blockH };
  }

  const nodes = scene.nodes;
  let boxes = new Map<string, Rect>();
  let divider: Rect | undefined;
  let spine: SceneGeometry["spine"];
  let chart: ChartLayout | undefined;
  if (scene.layout === "chart" && scene.chart && regions.length > 0) {
    chart = layoutChart(scene.chart, regions[0], ctx, seedBase + 3);
    occupied.push(chart.axes?.card ?? chart.bounds);
  } else if (nodes.length > 0 && regions.length > 0) {
    switch (scene.layout) {
      case "tree":
        boxes = layoutTree(scene, regions[0], ctx) ?? layoutFlow(nodes, regions, ctx);
        break;
      case "timeline": {
        const res = layoutTimeline(nodes, regions[0], ctx);
        boxes = res.boxes;
        spine = { rect: res.spine, ticks: res.ticks };
        break;
      }
      case "hub":
        boxes = layoutHub(scene, regions[0], ctx) ?? layoutFlow(nodes, regions, ctx);
        break;
      case "stack":
        boxes = capacity(regions[0], ctx) >= nodes.length / 2 ? layoutStack(nodes, regions[0], ctx) : layoutFlow(nodes, regions, ctx);
        break;
      case "cycle":
        boxes = layoutCycle(nodes, regions, ctx);
        break;
      case "compare": {
        const res = layoutCompare(nodes, regions, ctx);
        boxes = res.boxes;
        divider = res.divider;
        break;
      }
      default:
        boxes = layoutFlow(nodes, regions, ctx);
    }
  }
  occupied.push(...boxes.values());
  if (divider) occupied.push(inflate(divider, ctx.u));
  if (spine) occupied.push(inflate(spine.rect, ctx.u * 2));
  return { boxes, title, divider, spine, chart, occupied };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function placeNote(
  text: string,
  target: Rect | undefined,
  occupied: Rect[],
  regions: FreeRegion[],
  ctx: Ctx
): { x: number; y: number; lines: string[]; fontSize: number; blockWidth: number; rect: Rect; crosses: boolean } | null {
  const base = clamp(ctx.u * 4.8, 16, 72);
  let best: { x: number; y: number; lines: string[]; fontSize: number; blockWidth: number; rect: Rect; score: number; crosses: boolean } | null =
    null;
  const tc = target ? center(target) : null;
  for (const fontSize of [base, base * 0.86, base * 0.74]) {
    for (const region of regions) {
      const maxW = Math.min(region.w * 0.96, ctx.u * 40);
      const lines = wrapText(text, fontSize, maxW);
      if (lines.length > 3) continue;
      const bw = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize))) + ctx.u;
      const bh = lines.length * fontSize * LINE_HEIGHT_EM + ctx.u;
      if (bw > region.w || bh > region.h) continue;
      const steps = 8;
      for (let iy = 0; iy <= steps; iy++) {
        for (let ix = 0; ix <= steps; ix++) {
          const x = region.x + ((region.w - bw) * ix) / steps;
          const y = region.y + ((region.h - bh) * iy) / steps;
          const rect = { x, y, w: bw, h: bh };
          if (occupied.some((o) => overlaps(inflate(rect, ctx.u * 1.2), o))) continue;
          const c = center(rect);
          let score = (tc ? Math.hypot(c.x - tc.x, c.y - tc.y) : Math.hypot(c.x - region.x, c.y - region.y) * 0.3) + (base - fontSize) * 4;
          let crosses = false;
          // The pointer arrow must not slice through other drawings.
          if (tc && target) {
            for (let k = 1; k < 12; k++) {
              const px = c.x + ((tc.x - c.x) * k) / 12;
              const py = c.y + ((tc.y - c.y) * k) / 12;
              const hit = occupied.some(
                (o) => o !== target && !overlaps(o, target) && px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h
              );
              if (hit) {
                score += ctx.u * 60;
                crosses = true;
                break;
              }
            }
          }
          if (!best || score < best.score) best = { x, y, lines, fontSize, blockWidth: bw - ctx.u, rect, score, crosses };
        }
      }
    }
    if (best) break;
  }
  return best;
}

/**
 * A spot for a sticker: fully inside free space, clear of everything drawn,
 * as big as fits and as close as possible to what it illustrates. Like a
 * real sticker it may be stuck over a corner of its own target box (never
 * over much of it), which also lets it fit in tight bands above the head.
 * With no target it sits near the diagram as a whole.
 */
function placeSticker(aspect: number, target: Rect | undefined, occupied: Rect[], regions: FreeRegion[], ctx: Ctx): Rect | null {
  let anchors: { x: number; y: number }[] = [];
  if (target) {
    anchors = [
      { x: target.x, y: target.y },
      { x: target.x + target.w, y: target.y },
      { x: target.x, y: target.y + target.h },
      { x: target.x + target.w, y: target.y + target.h },
    ];
  } else if (occupied.length > 0) {
    const cs = occupied.map(center);
    anchors = [{ x: cs.reduce((a, c) => a + c.x, 0) / cs.length, y: cs.reduce((a, c) => a + c.y, 0) / cs.length }];
  }
  const others = target ? occupied.filter((o) => o !== target && !(o.x === target.x && o.y === target.y && o.w === target.w)) : occupied;
  const overlapArea = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  for (const side of [ctx.u * 25, ctx.u * 21, ctx.u * 17, ctx.u * 14]) {
    const w = aspect >= 1 ? side : side * aspect;
    const h = aspect >= 1 ? side / aspect : side;
    let best: { rect: Rect; score: number } | null = null;
    for (const region of regions) {
      if (w > region.w || h > region.h) continue;
      const steps = 14;
      for (let iy = 0; iy <= steps; iy++) {
        for (let ix = 0; ix <= steps; ix++) {
          const rect = { x: region.x + ((region.w - w) * ix) / steps, y: region.y + ((region.h - h) * iy) / steps, w, h };
          if (others.some((o) => overlaps(inflate(rect, ctx.u * 1.2), o))) continue;
          let stuck = 0;
          if (target) {
            const ov = overlapArea(rect, target);
            // A corner, not the label: cap how much of the box it may cover.
            if (ov > target.w * target.h * 0.16 || ov > w * h * 0.3) continue;
            stuck = ov;
          }
          const c = center(rect);
          const dist = anchors.length > 0 ? Math.min(...anchors.map((a) => Math.hypot(c.x - a.x, c.y - a.y))) : Math.hypot(c.x - region.x, c.y - region.y);
          // Bigger is better; a gap from the target is worse than a little overlap.
          const score = dist - (stuck > 0 ? ctx.u * 3 : 0);
          if (!best || score < best.score) best = { rect, score };
        }
      }
    }
    // Too far from what it illustrates reads as random clutter - try smaller first.
    if (best && (!target || best.score < ctx.u * 30)) return best.rect;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function edgeBends(scene: ResolvedDiagramScene, boxes: Map<string, Rect>, ctx: Ctx): Map<string, number> {
  const bends = new Map<string, number>();
  const pairs = new Set(scene.edges.map((e) => `${e.from}->${e.to}`));
  scene.edges.forEach((e, i) => {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) return;
    let bend = scene.layout === "tree" ? 0.03 : (i % 2 === 0 ? 1 : -1) * 0.1;
    if (pairs.has(`${e.to}->${e.from}`)) bend = 0.22; // same sign on the reverse edge = opposite side
    // Arc around any node sitting on the straight path.
    const ca = center(a);
    const cb = center(b);
    for (const [id, box] of boxes) {
      if (id === e.from || id === e.to) continue;
      const hit = [0.25, 0.4, 0.5, 0.6, 0.75].some((t) => {
        const p = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t };
        const r = inflate(box, ctx.u);
        return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
      });
      if (hit) {
        bend = Math.sign(bend || 1) * 0.42;
        break;
      }
    }
    bends.set(e.id, bend);
  });
  return bends;
}

export function buildRenderPlan(plan: ResolvedDiagramPlan, space: FreeSpace, stickers: StickerAssets = {}, style: RenderStyle = "classic"): RenderPlan {
  const { width: W, height: H } = space;
  const ctx: Ctx = { W, H, u: Math.min(W, H) / 100 };
  const fps = plan.fps;
  const totalFrames = Math.max(1, Math.round(plan.durationSeconds * fps));
  const lead = Math.round(LEAD_SECONDS * fps);
  const eraseFrames = Math.round(ERASE_SECONDS * fps);
  const sec = (s: number) => Math.max(1, Math.round(s * fps));

  const sceneStarts = plan.scenes.map((s) => Math.max(0, (s.ops[0]?.frame ?? 0) - lead));
  const renderScenes: RenderScene[] = [];
  const dropped: NonNullable<RenderPlan["dropped"]> = [];

  plan.scenes.forEach((scene0, si) => {
    // A timeline's order is carried by its time arrow; extra arrows between events would zig-zag across it.
    const scene: ResolvedDiagramScene = scene0.layout === "timeline" ? { ...scene0, edges: [] } : scene0;
    const sceneStart = sceneStarts[si];
    const sceneEnd = si + 1 < plan.scenes.length ? Math.max(sceneStart + eraseFrames * 2, sceneStarts[si + 1] - 1) : totalFrames + fps;
    const lastDrawFrame = sceneEnd - eraseFrames;

    const seedBase = hash(`${scene.id}`);
    const geo = layoutScene(scene, space, ctx, seedBase);
    const bends = edgeBends(scene, geo.boxes, ctx);
    // Arrows (and their labels) are occupied space too, so notes don't land on them.
    for (const e of scene.edges) {
      const a = geo.boxes.get(e.from);
      const b = geo.boxes.get(e.to);
      if (!a || !b) continue;
      const shapeA = nodeById0(scene, e.from);
      const shapeB = nodeById0(scene, e.to);
      const g = edgeCurve(a, shapeA, b, shapeB, bends.get(e.id) ?? 0.1, ctx.u * 1.6);
      for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const p = quadPoint(g.p0, g.c, g.p1, t);
        const half = t === 0.5 && e.label ? Math.max(ctx.u * 3, estimateTextWidth(e.label, ctx.u * 4.5) / 2 + ctx.u) : ctx.u * 1.5;
        geo.occupied.push({ x: p.x - half, y: p.y - ctx.u * 3.5, w: half * 2, h: ctx.u * 7 });
      }
    }
    const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(scene.edges.map((e) => [e.id, e]));

    // One font size per scene so labels read as a consistent set.
    const labelMax = clamp(ctx.u * 5.8, 18, 96);
    let sceneFont = labelMax;
    for (const node of scene.nodes) {
      const box = geo.boxes.get(node.id);
      if (!box) continue;
      const ta = nodeContentLayout(node.shape ?? "box", box, !!node.icon).text;
      sceneFont = Math.min(sceneFont, fitText(node.label, ta.w, ta.h, labelMax, labelMax * 0.68, ta.h > labelMax * 2.6 ? 3 : 2).fontSize);
    }

    const elements: RenderElement[] = [];
    const nodeEls = new Map<string, NodeElement>();
    const edgeEls = new Map<string, EdgeElement>();
    let penFree = sceneStart;
    /** True while filling in elements the plan declared but never triggered - those have no cue word. */
    let autoFill = false;
    const cueOf = (frame: number) => (autoFill ? undefined : frame);

    /** Single-pen scheduler: queue behind the previous stroke unless that would lag the speech too much. */
    const schedule = (wanted: number, seconds: number, earliest = 0): { start: number; duration: number } | null => {
      let start = Math.max(wanted - lead, earliest, sceneStart);
      let duration = sec(seconds);
      if (penFree > start) {
        const delay = penFree - start;
        if (delay <= MAX_PEN_DELAY_SECONDS * fps) {
          start = penFree;
          duration = Math.max(sec(0.25), Math.round(duration * 0.75)); // hurry to catch up
        }
      }
      if (start >= lastDrawFrame) return null;
      duration = Math.min(duration, Math.max(sec(0.2), lastDrawFrame - start));
      penFree = Math.max(penFree, start + Math.round(duration * 0.88));
      return { start, duration };
    };
    const endOf = (el: { start: number; duration: number }) => el.start + el.duration;

    const ensureNode = (id: string, frame: number): NodeElement | null => {
      const existing = nodeEls.get(id);
      if (existing) return existing;
      const node = nodeById.get(id);
      const box = geo.boxes.get(id);
      if (!node || !box) return null;
      const shape = node.shape ?? "box";
      const textArea = nodeContentLayout(shape, box, !!node.icon).text;
      const lines = wrapText(node.label, sceneFont, textArea.w).slice(0, 3);
      const idx = scene.nodes.indexOf(node);
      const proto = {
        kind: "node" as const,
        id: `${scene.id}:${id}`,
        seed: seedBase + hash(id),
        color: node.color ?? NODE_PALETTE[idx % NODE_PALETTE.length],
        box,
        shape,
        icon: node.icon,
        lines,
        fontSize: sceneFont,
      };
      const t = schedule(frame, nodePhases(proto, W, H).total);
      if (!t) {
        if (!autoFill) dropped.push({ sceneId: scene.id, target: id, label: node.label, frame });
        return null;
      }
      const el: NodeElement = { ...proto, ...t, cue: cueOf(frame) };
      nodeEls.set(id, el);
      elements.push(el);
      return el;
    };

    const ensureEdge = (id: string, frame: number): EdgeElement | null => {
      const existing = edgeEls.get(id);
      if (existing) return existing;
      const edge = edgeById.get(id);
      if (!edge) return null;
      const a = ensureNode(edge.from, frame);
      const b = ensureNode(edge.to, frame);
      if (!a || !b) return null;
      const proto = {
        kind: "edge" as const,
        id: `${scene.id}:${id}`,
        seed: seedBase + hash(id),
        color: a.color,
        from: a.box,
        to: b.box,
        fromShape: a.shape,
        toShape: b.shape,
        label: edge.label,
        fontSize: clamp(Math.max(sceneFont * 0.8, ctx.u * 4), 14, 64),
        dashed: !!edge.dashed,
        bidirectional: !!edge.bidirectional,
        bend: bends.get(id) ?? 0.1,
      };
      const earliest = Math.max(a.start + Math.round(a.duration * 0.6), b.start + Math.round(b.duration * 0.6));
      const t = schedule(frame, edgePhases(proto, W, H).total, earliest);
      if (!t) return null;
      const el: EdgeElement = { ...proto, ...t, cue: cueOf(frame) };
      edgeEls.set(id, el);
      elements.push(el);
      return el;
    };

    // --- Charts: axes first, then each data point on its own word. -------------
    type ChartPartEl = BarElement | PointElement | SliceElement;
    const chartEls = new Map<string, ChartPartEl>();
    let axesEl: AxesElement | null | undefined;
    const ensureAxes = (frame: number): AxesElement | null => {
      if (axesEl !== undefined) return axesEl;
      const proto = geo.chart?.axes;
      if (!proto) return (axesEl = null);
      const t = schedule(frame, axesPhases(proto, W, H).total);
      if (!t) return (axesEl = null);
      axesEl = { ...proto, id: `${scene.id}:axes`, ...t };
      elements.push(axesEl);
      return axesEl;
    };
    const ensureDatum = (id: string, frame: number): ChartPartEl | null => {
      const existing = chartEls.get(id);
      if (existing) return existing;
      const proto = geo.chart?.parts.get(id);
      if (!proto) return null;
      const axes = ensureAxes(frame);
      const earliest = axes ? axes.start + Math.round(axes.duration * 0.75) : 0;
      // A line segment needs the previous point on the page first.
      const order = scene.chart?.data.findIndex((d) => d.id === id) ?? -1;
      let after = earliest;
      if (proto.kind === "point" && order > 0) {
        const prevId = scene.chart!.data[order - 1].id;
        const prev = ensureDatum(prevId, frame);
        if (prev) after = Math.max(after, prev.start + Math.round(prev.duration * 0.8));
      }
      const seconds =
        proto.kind === "bar"
          ? barPhases(proto).total
          : proto.kind === "point"
            ? pointPhases(proto, W, H).total
            : slicePhases(proto).total;
      const t = schedule(frame, seconds, after);
      if (!t) {
        const d = scene.chart?.data.find((x) => x.id === id);
        if (!autoFill && d) dropped.push({ sceneId: scene.id, target: id, label: d.label, frame });
        return null;
      }
      const el = { ...proto, id: `${scene.id}:${id}`, seed: seedBase + hash(id), ...t, cue: cueOf(frame) } as ChartPartEl;
      chartEls.set(id, el);
      elements.push(el);
      return el;
    };
    /** Anything emphasis or a note can point at: a node or a chart data point. */
    const ensureTarget = (id: string, frame: number): { box: Rect; shape: NodeShape; start: number; duration: number; color: Accent } | null => {
      if (nodeById.has(id)) return ensureNode(id, frame);
      const datum = ensureDatum(id, frame);
      const box = geo.chart?.targets.get(id);
      if (!datum || !box) return null;
      return { box, shape: datum.kind === "bar" ? "box" : "circle", start: datum.start, duration: datum.duration, color: datum.color };
    };

    const addMark = (mark: MarkType, target: { box: Rect; shape: NodeShape; start: number; duration: number }, frame: number, key: string) => {
      const t = schedule(frame, MARK_SECONDS[mark], target.start + Math.round(target.duration * 0.7));
      if (!t) return;
      const el: MarkElement = {
        kind: "mark",
        id: `${scene.id}:${key}`,
        seed: seedBase + hash(key),
        color: MARK_COLOR[mark],
        mark,
        target: target.box,
        targetShape: target.shape,
        ...t,
        cue: cueOf(frame),
      };
      elements.push(el);
    };

    const notePlaced: Rect[] = [];
    let titleDone = false;
    let dividerDone = !geo.divider;
    let spineDone = !geo.spine;

    for (const op of scene.ops) {
      const f = op.frame;
      // Rule the chart's axes in as the scene opens, so each bar/point can land right on its word.
      if (geo.chart && axesEl === undefined) ensureAxes(f);
      if (!dividerDone && (op.type === "draw" || op.type === "connect") && geo.divider) {
        dividerDone = true;
        const t = schedule(f, MARK_SECONDS.divider);
        if (t) {
          elements.push({
            kind: "mark",
            id: `${scene.id}:divider`,
            seed: seedBase + 7,
            color: MARK_COLOR.divider,
            mark: "divider",
            target: geo.divider,
            targetShape: "box",
            ...t,
          });
        }
      }

      if (!spineDone && op.type === "draw" && geo.spine) {
        spineDone = true;
        const t = schedule(f, MARK_SECONDS.spine);
        if (t) {
          elements.push({
            kind: "mark",
            id: `${scene.id}:spine`,
            seed: seedBase + 11,
            color: MARK_COLOR.spine,
            mark: "spine",
            target: geo.spine.rect,
            targetShape: "box",
            ticks: geo.spine.ticks,
            ...t,
          });
        }
      }

      switch (op.type) {
        case "title": {
          if (titleDone || !geo.title) {
            // Extra titles become free-floating notes.
            if (op.text) addNote(op.text, undefined, f, op.id);
            break;
          }
          titleDone = true;
          const proto = { lines: geo.title.lines, variant: "title" as const, pointTo: undefined };
          const t = schedule(f, textPhases(proto).total);
          if (!t) break;
          elements.push({
            kind: "text",
            id: `${scene.id}:${op.id}`,
            seed: seedBase + hash(op.id),
            color: "orange",
            variant: "title",
            lines: geo.title.lines,
            fontSize: geo.title.fontSize,
            x: geo.title.x,
            y: geo.title.y,
            align: "center",
            blockWidth: geo.title.blockWidth,
            ...t,
            cue: f,
          });
          break;
        }
        case "draw":
          if (op.target) ensureNode(op.target, f);
          break;
        case "connect":
          if (op.target) ensureEdge(op.target, f);
          break;
        case "flow": {
          if (!op.target) break;
          const edge = ensureEdge(op.target, f);
          if (!edge) break;
          const start = Math.max(f - lead, endOf(edge));
          if (start >= lastDrawFrame) break;
          elements.push({
            kind: "packet",
            id: `${scene.id}:${op.id}`,
            seed: seedBase + hash(op.id),
            color: "yellow",
            edgeId: edge.id,
            trips: 2,
            start,
            duration: Math.min(sec(PACKET_TRIP_SECONDS * 2), lastDrawFrame + eraseFrames - start),
          });
          break;
        }
        case "note":
          if (op.text) addNote(op.text, op.target, f, op.id);
          break;
        case "plot":
          if (op.target) ensureDatum(op.target, f);
          break;
        case "sticker":
          if (op.text) addSticker(op.text, op.target, f, op.id);
          break;
        default: {
          if (!op.target) break;
          const target = ensureTarget(op.target, f);
          if (!target) break;
          const mark = op.type as MarkType;
          const text = geo.chart?.textTargets.get(op.target);
          // On a chart, a marker stroke across a bar/slice reads as a smudge - mark its written label instead.
          if (text && (mark === "highlight" || mark === "underline")) addMark(mark, { ...target, box: text, shape: "box" }, f, op.id);
          else addMark(mark, target, f, op.id);
        }
      }
    }

    function addNote(text: string, targetId: string | undefined, frame: number, key: string) {
      const targetNode = targetId ? ensureTarget(targetId, frame) : null;
      const placed = placeNote(text, targetNode?.box, [...geo.occupied, ...notePlaced], space.regions, ctx);
      if (!placed) return;
      notePlaced.push(placed.rect);
      const gap = targetNode
        ? Math.max(
            0,
            Math.max(targetNode.box.x - (placed.rect.x + placed.rect.w), placed.rect.x - (targetNode.box.x + targetNode.box.w)),
            Math.max(targetNode.box.y - (placed.rect.y + placed.rect.h), placed.rect.y - (targetNode.box.y + targetNode.box.h))
          )
        : 0;
      // No pointer if it would have to slice through another drawing - the note just sits nearby.
      const pointTo = targetNode && gap > ctx.u * 2 && !placed.crosses ? targetNode.box : undefined;
      const proto = { lines: placed.lines, variant: "note" as const, pointTo };
      const t = schedule(frame, textPhases(proto).total, targetNode ? targetNode.start + Math.round(targetNode.duration * 0.6) : 0);
      if (!t) return;
      elements.push({
        kind: "text",
        id: `${scene.id}:${key}`,
        seed: seedBase + hash(key),
        color: targetNode?.color ?? "purple",
        variant: "note",
        lines: placed.lines,
        fontSize: placed.fontSize,
        x: placed.x,
        y: placed.y,
        align: "left",
        blockWidth: placed.blockWidth,
        pointTo,
        ...t,
        cue: cueOf(frame),
      });
    }

    function addSticker(subject: string, targetId: string | undefined, frame: number, key: string) {
      const asset = stickers[stickerKey(subject, scene.tone)] ?? stickers[legacyStickerKey(subject)];
      if (!asset) return; // generation failed or was skipped - nothing to show
      const target = targetId ? ensureTarget(targetId, frame) : null;
      const rect = placeSticker(asset.width / Math.max(1, asset.height), target?.box, [...geo.occupied, ...notePlaced], space.regions, ctx);
      if (!rect) return;
      // Not pen-drawn, so it doesn't queue behind the pen - it lands right on its word.
      const start = Math.max(frame - lead, sceneStart, target ? target.start + Math.round(target.duration * 0.5) : 0);
      if (start >= lastDrawFrame) return;
      const profile = toneProfile(scene.tone);
      const t = { start, duration: sec(profile.entranceSeconds ?? STICKER_SECONDS) };
      notePlaced.push(rect);
      const seed = seedBase + hash(key);
      elements.push({
        kind: "sticker",
        id: `${scene.id}:${key}`,
        seed,
        color: target?.color ?? "yellow",
        box: rect,
        src: asset.src,
        tilt: ((seed % 1000) / 1000 - 0.5) * 16,
        subject,
        material: profile.material,
        entrance: profile.entrance,
        // Lifts off just before the scene wipe, rather than fading with the drawing.
        exitAt: Math.max(start + t.duration, lastDrawFrame - sec(0.1)),
        ...t,
        cue: cueOf(frame),
      });
    }

    // Anything the model declared but never triggered still gets drawn, so a
    // lazy plan doesn't leave holes: nodes first, then their arrows.
    autoFill = true;
    for (const node of scene.nodes) if (!nodeEls.has(node.id)) ensureNode(node.id, penFree + lead);
    for (const edge of scene.edges) if (!edgeEls.has(edge.id)) ensureEdge(edge.id, penFree + lead);
    for (const d of scene.chart?.data ?? []) if (!chartEls.has(d.id)) ensureDatum(d.id, penFree + lead);

    if (elements.length === 0) return;
    elements.sort((a, b) => a.start - b.start);
    renderScenes.push({ id: scene.id, tone: scene.tone, start: elements[0].start, end: sceneEnd, elements });
  });

  return {
    version: "2.0",
    fps,
    durationSeconds: plan.durationSeconds,
    width: W,
    height: H,
    theme: space.theme,
    regions: space.regions,
    scenes: renderScenes,
    dropped,
    ...(style === "journal" ? { style, sweeps: buildSweeps(renderScenes, space, fps, totalFrames) } : {}),
    ...(style === "hormozi" ? { style, keywords: buildKeywords(plan, space, fps, totalFrames) } : {}),
  };
}
