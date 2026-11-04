/**
 * Lays a chart (bar / line / pie) out in pixels inside one free region.
 * Produces element *prototypes* (everything except start/duration) - the
 * single-pen scheduler in buildRenderPlan decides when each one is drawn.
 *
 * Pure TypeScript, no DOM: runs in Node and in the Remotion preview.
 */
import type {
  Accent,
  AxesElement,
  BarElement,
  ChartDatum,
  ChartSpec,
  PointElement,
  Rect,
  SliceElement,
} from "@/types/diagramPlan";
import { LINE_HEIGHT_EM, estimateTextWidth, inflate, wrapText } from "./geometry";

type Proto<T> = Omit<T, "start" | "duration">;

export interface ChartLayout {
  axes?: Proto<AxesElement>;
  /** One prototype per datum id, in data order. */
  parts: Map<string, Proto<BarElement> | Proto<PointElement> | Proto<SliceElement>>;
  /** What emphasis marks / notes wrap or point at, per datum id. */
  targets: Map<string, Rect>;
  /** The datum's written label/value - highlight and underline go on text, not on the shape. */
  textTargets: Map<string, Rect>;
  /** Everything the chart covers (for note placement). */
  bounds: Rect;
}

interface Ctx {
  W: number;
  H: number;
  u: number;
}

const PALETTE: Accent[] = ["blue", "pink", "green", "orange", "purple"];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const widest = (lines: string[], fs: number) => Math.max(0, ...lines.map((l) => estimateTextWidth(l, fs)));

/** "40" + "%" -> "40%", "3" + "x" -> "3x", "1200" + "users" -> "1,200 users", "$" -> "$9". */
export function formatValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2;
  const num = Number(value.toFixed(digits)).toLocaleString("en-US");
  const u = unit?.trim();
  if (!u) return num;
  if (u === "$" || u === "£" || u === "€") return `${u}${num}`;
  return u.length <= 2 || !/^[a-z]/i.test(u) ? `${num}${u}` : `${num} ${u}`;
}

function colorOf(d: ChartDatum, i: number): Accent {
  return d.color ?? PALETTE[i % PALETTE.length];
}

/** Wraps a label into <= 2 lines inside maxW, shrinking the font a little if needed. */
function fitLabel(text: string, fs: number, maxW: number): { lines: string[]; fontSize: number } {
  for (const f of [fs, fs * 0.88, fs * 0.76]) {
    const lines = wrapText(text, f, maxW);
    if (lines.length <= 2 && widest(lines, f) <= maxW * 1.04) return { lines, fontSize: f };
  }
  const f = fs * 0.76;
  return { lines: wrapText(text, f, maxW).slice(0, 2), fontSize: f };
}

function baseFont(region: Rect, ctx: Ctx): number {
  return clamp(Math.min(ctx.u * 4.4, region.h * 0.11), 12, 64);
}

function cardFor(bounds: Rect, ctx: Ctx): Rect {
  const c = inflate(bounds, ctx.u * 1.8);
  const x = Math.max(0, c.x);
  const y = Math.max(0, c.y);
  return { x, y, w: Math.min(ctx.W, c.x + c.w) - x, h: Math.min(ctx.H, c.y + c.h) - y };
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

function layoutBars(chart: ChartSpec, R: Rect, ctx: Ctx, seed: number): ChartLayout {
  const { data } = chart;
  const n = data.length;
  const fs = baseFont(R, ctx);
  const showValues = chart.showValues !== false;
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const values = data.map((d) => (showValues ? formatValue(d.value, chart.unit) : undefined));
  const yLabelH = chart.yLabel ? fs * LINE_HEIGHT_EM : 0;
  const parts: ChartLayout["parts"] = new Map();
  const targets = new Map<string, Rect>();
  const textTargets = new Map<string, Rect>();

  const vertical = R.w / n >= ctx.u * 10 && R.h >= ctx.u * 16;

  if (vertical) {
    const slot0 = (R.w - ctx.u * 2) / n;
    const labels = data.map((d) => fitLabel(d.label, fs, slot0 * 0.94));
    const labelFs = Math.min(...labels.map((l) => l.fontSize));
    const labelRows = Math.max(...labels.map((l) => l.lines.length));
    const labelH = labelRows * labelFs * LINE_HEIGHT_EM + ctx.u * 1.2;
    const valueH = showValues ? fs * LINE_HEIGHT_EM + ctx.u * 0.6 : ctx.u;
    const plot: Rect = {
      x: R.x + ctx.u * 2,
      y: R.y + yLabelH + valueH,
      w: R.w - ctx.u * 3,
      h: Math.max(ctx.u * 6, R.h - yLabelH - valueH - labelH),
    };
    const slot = plot.w / n;
    const barW = Math.min(slot * 0.6, ctx.u * 14);
    data.forEach((d, i) => {
      const h = Math.max(ctx.u * 0.8, (d.value / max) * plot.h * 0.96);
      const bar: Rect = { x: plot.x + slot * i + (slot - barW) / 2, y: plot.y + plot.h - h, w: barW, h };
      const cx = bar.x + barW / 2;
      const lines = wrapText(d.label, labelFs, slot * 0.94).slice(0, 2);
      parts.set(d.id, {
        kind: "bar",
        id: d.id,
        seed: seed + i * 17,
        color: colorOf(d, i),
        bar,
        orientation: "vertical",
        label: lines.join("\n"),
        labelAt: { x: cx - slot * 0.47, y: plot.y + plot.h + ctx.u * 1, w: slot * 0.94, align: "center" },
        value: values[i],
        valueAt: values[i] ? { x: cx - slot * 0.5, y: bar.y - fs * LINE_HEIGHT_EM - ctx.u * 0.3, w: slot, align: "center" } : undefined,
        fontSize: labelFs,
      });
      targets.set(d.id, bar);
      const lw = widest(lines, labelFs);
      textTargets.set(d.id, { x: cx - lw / 2, y: plot.y + plot.h + ctx.u, w: lw, h: lines.length * labelFs * LINE_HEIGHT_EM });
    });
    const bounds: Rect = { x: R.x, y: R.y, w: R.w, h: plot.y + plot.h + labelH - R.y };
    return {
      axes: {
        kind: "axes",
        id: "axes",
        seed,
        color: "purple",
        plot,
        grid: [0.33, 0.66, 1].map((g) => g * 0.96),
        yLabel: chart.yLabel,
        fontSize: fs * 0.85,
        card: cardFor(bounds, ctx),
      },
      parts,
      targets,
      textTargets,
      bounds,
    };
  }

  // Horizontal bars: category labels down the left, bars grow to the right.
  const rowH = (R.h - yLabelH) / n;
  const labelFs = clamp(Math.min(fs, rowH * 0.5), 11, 64);
  const labelColW = Math.min(R.w * 0.34, Math.max(...data.map((d) => estimateTextWidth(d.label, labelFs))) + ctx.u);
  const valueW = showValues ? Math.max(...values.map((v) => estimateTextWidth(v ?? "", labelFs))) + ctx.u * 1.5 : ctx.u;
  const plot: Rect = { x: R.x + labelColW + ctx.u, y: R.y + yLabelH, w: Math.max(ctx.u * 8, R.w - labelColW - valueW - ctx.u * 1.5), h: R.h - yLabelH };
  const barH = Math.min(rowH * 0.62, ctx.u * 9);
  data.forEach((d, i) => {
    const w = Math.max(ctx.u * 0.8, (d.value / max) * plot.w * 0.97);
    const cy = plot.y + rowH * i + rowH / 2;
    const bar: Rect = { x: plot.x, y: cy - barH / 2, w, h: barH };
    const lines = wrapText(d.label, labelFs, labelColW - ctx.u).slice(0, 2);
    const lh = lines.length * labelFs * LINE_HEIGHT_EM;
    parts.set(d.id, {
      kind: "bar",
      id: d.id,
      seed: seed + i * 17,
      color: colorOf(d, i),
      bar,
      orientation: "horizontal",
      label: lines.join("\n"),
      labelAt: { x: R.x, y: cy - lh / 2, w: labelColW - ctx.u * 0.5, align: "right" },
      value: values[i],
      valueAt: values[i] ? { x: bar.x + w + ctx.u * 0.8, y: cy - (labelFs * LINE_HEIGHT_EM) / 2, w: valueW, align: "left" } : undefined,
      fontSize: labelFs,
    });
    targets.set(d.id, bar);
    const lw = widest(lines, labelFs);
    textTargets.set(d.id, { x: R.x + labelColW - ctx.u * 0.5 - lw, y: cy - lh / 2, w: lw, h: lh });
  });
  const bounds: Rect = { ...R };
  return {
    axes: {
      kind: "axes",
      id: "axes",
      seed,
      color: "purple",
      plot,
      grid: [],
      yLabel: chart.yLabel,
      fontSize: fs * 0.85,
      card: cardFor(bounds, ctx),
    },
    parts,
    targets,
    textTargets,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

function layoutLine(chart: ChartSpec, R: Rect, ctx: Ctx, seed: number): ChartLayout {
  const { data } = chart;
  const n = data.length;
  const fs = baseFont(R, ctx);
  const showValues = chart.showValues !== false;
  const yLabelH = chart.yLabel ? fs * LINE_HEIGHT_EM : 0;
  const slot0 = (R.w - ctx.u * 3) / n;
  const labels = data.map((d) => fitLabel(d.label, fs * 0.9, slot0 * 0.98));
  const labelFs = Math.min(...labels.map((l) => l.fontSize));
  const labelRows = Math.max(...labels.map((l) => l.lines.length));
  const labelH = labelRows * labelFs * LINE_HEIGHT_EM + ctx.u * 1.2;
  const valueH = showValues ? fs * LINE_HEIGHT_EM + ctx.u * 0.6 : ctx.u * 1.5;
  const plot: Rect = {
    x: R.x + ctx.u * 2,
    y: R.y + yLabelH + valueH,
    w: R.w - ctx.u * 3,
    h: Math.max(ctx.u * 6, R.h - yLabelH - valueH - labelH),
  };

  const vals = data.map((d) => d.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo >= 0 && lo <= hi * 0.5) lo = 0;
  else lo -= (hi - lo) * 0.15;
  if (hi - lo < 1e-9) hi = lo + 1;

  const slot = plot.w / n;
  const parts: ChartLayout["parts"] = new Map();
  const targets = new Map<string, Rect>();
  const textTargets = new Map<string, Rect>();
  const baseline = plot.y + plot.h;
  let prev: { x: number; y: number } | undefined;
  data.forEach((d, i) => {
    const at = { x: plot.x + slot * (i + 0.5), y: baseline - ((d.value - lo) / (hi - lo)) * plot.h * 0.92 };
    const value = showValues ? formatValue(d.value, chart.unit) : undefined;
    const lines = wrapText(d.label, labelFs, slot * 0.98).slice(0, 2);
    parts.set(d.id, {
      kind: "point",
      id: d.id,
      seed: seed + i * 17,
      color: chart.data[0].color ?? "blue",
      at,
      prev,
      baseline,
      label: lines.join("\n"),
      labelAt: { x: at.x - slot * 0.49, y: baseline + ctx.u, w: slot * 0.98 },
      value,
      valueAt: value ? { x: at.x - slot * 0.5, y: at.y - fs * LINE_HEIGHT_EM - ctx.u * 0.6, w: slot } : undefined,
      fontSize: labelFs,
    });
    const r = ctx.u * 2.6;
    targets.set(d.id, { x: at.x - r, y: at.y - r, w: r * 2, h: r * 2 });
    const lw = widest(lines, labelFs);
    textTargets.set(d.id, { x: at.x - lw / 2, y: baseline + ctx.u, w: lw, h: lines.length * labelFs * LINE_HEIGHT_EM });
    prev = at;
  });
  const bounds: Rect = { x: R.x, y: R.y, w: R.w, h: baseline + labelH - R.y };
  return {
    axes: {
      kind: "axes",
      id: "axes",
      seed,
      color: "purple",
      plot,
      grid: [0.33, 0.66, 1].map((g) => g * 0.92),
      yLabel: chart.yLabel,
      fontSize: fs * 0.85,
      card: cardFor(bounds, ctx),
    },
    parts,
    targets,
    textTargets,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Pie / donut
// ---------------------------------------------------------------------------

interface PlacedLabel {
  lines: string[];
  box: Rect;
  align: "left" | "center" | "right";
  leaderFrom: { x: number; y: number };
  leaderTo: { x: number; y: number };
}

const at = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });

function placePieLabels(
  chart: ChartSpec,
  angles: [number, number][],
  cx: number,
  cy: number,
  r: number,
  fs: number,
  R: Rect,
  ctx: Ctx
): PlacedLabel[] | null {
  const total = chart.data.reduce((s, d) => s + d.value, 0);
  const showValues = chart.showValues !== false;
  const out: PlacedLabel[] = [];
  for (let i = 0; i < chart.data.length; i++) {
    const d = chart.data[i];
    const mid = (angles[i][0] + angles[i][1]) / 2;
    const pct = showValues ? (chart.unit && chart.unit !== "%" ? formatValue(d.value, chart.unit) : `${Math.round((d.value / total) * 100)}%`) : "";
    const lines = [...wrapText(d.label, fs, ctx.u * 22).slice(0, 2), ...(pct ? [pct] : [])];
    const w = widest(lines, fs);
    const h = lines.length * fs * LINE_HEIGHT_EM;
    const sx = Math.sin(mid);
    const align: PlacedLabel["align"] = sx > 0.35 ? "left" : sx < -0.35 ? "right" : "center";
    const gap = ctx.u * 2.2;
    const anchor = at(cx, cy, r + gap, mid);
    const x = align === "left" ? anchor.x : align === "right" ? anchor.x - w : anchor.x - w / 2;
    const cosA = -Math.cos(mid); // +1 at the bottom
    const y = align === "center" ? (cosA > 0 ? anchor.y : anchor.y - h) : anchor.y - h / 2;
    const box = { x, y, w, h };
    if (box.x < R.x || box.y < R.y || box.x + box.w > R.x + R.w || box.y + box.h > R.y + R.h) return null;
    if (out.some((o) => !(box.x + box.w < o.box.x || o.box.x + o.box.w < box.x || box.y + box.h < o.box.y || o.box.y + o.box.h < box.y)))
      return null;
    out.push({ lines, box, align, leaderFrom: at(cx, cy, r * 1.02, mid), leaderTo: at(cx, cy, r + gap * 0.75, mid) });
  }
  return out;
}

function layoutPie(chart: ChartSpec, R: Rect, ctx: Ctx, seed: number): ChartLayout {
  const total = chart.data.reduce((s, d) => s + d.value, 0) || 1;
  const angles: [number, number][] = [];
  let acc = 0;
  for (const d of chart.data) {
    const a0 = (acc / total) * Math.PI * 2;
    acc += d.value;
    angles.push([a0, (acc / total) * Math.PI * 2]);
  }

  const fs0 = baseFont(R, ctx);
  const cx = R.x + R.w / 2;
  const cy = R.y + R.h / 2;
  let placed: PlacedLabel[] | null = null;
  let r = 0;
  let fs = fs0;
  // Largest pie whose labels all fit around it; shrink the type before giving up on size.
  search: for (const f of [fs0, fs0 * 0.86, fs0 * 0.74]) {
    for (let rr = Math.min(R.w, R.h) * 0.46; rr >= ctx.u * 6; rr *= 0.93) {
      const p = placePieLabels(chart, angles, cx, cy, rr, f, R, ctx);
      if (p) {
        placed = p;
        r = rr;
        fs = f;
        break search;
      }
    }
  }
  if (!placed) {
    // Nothing fits - a small pie with labels as close as they'll go.
    fs = fs0 * 0.72;
    r = Math.max(ctx.u * 6, Math.min(R.w, R.h) * 0.3);
    placed = placePieLabels(chart, angles, cx, cy, r, fs, { x: 0, y: 0, w: ctx.W, h: ctx.H }, ctx) ?? [];
  }

  const parts: ChartLayout["parts"] = new Map();
  const targets = new Map<string, Rect>();
  const textTargets = new Map<string, Rect>();
  const inner = r * 0.46;
  chart.data.forEach((d, i) => {
    const [a0, a1] = angles[i];
    const label = placed![i];
    parts.set(d.id, {
      kind: "slice",
      id: d.id,
      seed: seed + i * 17,
      color: colorOf(d, i),
      cx,
      cy,
      r,
      inner,
      a0,
      a1,
      lines: label?.lines ?? [d.label],
      labelAt: label ? { x: label.box.x, y: label.box.y, w: label.box.w, align: label.align } : { x: cx, y: cy, w: 0, align: "center" },
      leader: label ? { from: label.leaderFrom, to: label.leaderTo } : undefined,
      fontSize: fs,
    });
    const c = at(cx, cy, (r + inner) / 2, (a0 + a1) / 2);
    const s = (r - inner) * 0.75;
    targets.set(d.id, { x: c.x - s / 2, y: c.y - s / 2, w: s, h: s });
    if (label) textTargets.set(d.id, label.box);
  });

  let bounds: Rect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  for (const p of placed) {
    const x0 = Math.min(bounds.x, p.box.x);
    const y0 = Math.min(bounds.y, p.box.y);
    bounds = { x: x0, y: y0, w: Math.max(bounds.x + bounds.w, p.box.x + p.box.w) - x0, h: Math.max(bounds.y + bounds.h, p.box.y + p.box.h) - y0 };
  }
  return { parts, targets, textTargets, bounds };
}

export function layoutChart(chart: ChartSpec, region: Rect, ctx: Ctx, seed: number): ChartLayout {
  // A little breathing room inside the region.
  const R = inflate(region, -ctx.u * 0.6);
  switch (chart.type) {
    case "line":
      return layoutLine(chart, R, ctx, seed);
    case "pie":
      return layoutPie(chart, R, ctx, seed);
    default:
      return layoutBars(chart, R, ctx, seed);
  }
}
