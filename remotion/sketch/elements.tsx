import React from "react";
import type {
  EdgeElement,
  MarkElement,
  NodeElement,
  NodeShape,
  PacketElement,
  Rect,
  TextElement,
} from "@/types/diagramPlan";
import {
  LINE_HEIGHT_EM,
  boundaryPoint,
  center,
  edgeCurve,
  estimateTextWidth,
  nodeContentLayout,
  quadPoint,
} from "@/lib/layout/geometry";
import { PACKET_TRIP_SECONDS, edgePhases, nodePhases, textPhases, type Phase } from "@/lib/layout/timing";
import { handFontFamily } from "../fonts";
import { iconStrokes } from "./icons";
import {
  arrowHead,
  boil,
  densify,
  hachure,
  handLine,
  partial,
  quad,
  rng,
  sketchCloud,
  sketchCylinder,
  sketchDiamond,
  sketchDoc,
  sketchEllipse,
  sketchRect,
  toPath,
  wobble,
  type Pt,
  type Rand,
  type Shape,
  type Stroke,
} from "./rough";
import type { Palette } from "./theme";

export interface DrawCtx {
  frame: number;
  fps: number;
  width: number;
  height: number;
  /** 1% of the frame's short side. */
  u: number;
  palette: Palette;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Progress (0..1) of a phase, honouring an element whose duration was compressed by the scheduler. */
function phaseProgress(local: number, duration: number, total: number, fps: number, phase: Phase | null): number {
  if (!phase) return 0;
  const scale = duration / Math.max(1, total * fps);
  const t = local / fps / scale;
  return clamp01((t - phase.start) / Math.max(1e-3, phase.end - phase.start));
}

function strokeWidth(ctx: DrawCtx): number {
  return Math.max(2, ctx.u * 0.58);
}

/** Wobble + boil a set of strokes. Wobble is seeded (stable); boil changes every few frames once drawn. */
function liven(strokes: Stroke[], r: Rand, ctx: DrawCtx, seed: number, wobbleAmp: number, boilOn: boolean): Stroke[] {
  return strokes.map((s, i) => {
    const w = wobble(densify(s, ctx.u * 1.2), wobbleAmp, r);
    return boilOn ? boil(w, ctx.frame, ctx.u * 0.12, seed + i * 31) : w;
  });
}

// ---------------------------------------------------------------------------
// Low-level drawing bits
// ---------------------------------------------------------------------------

const InkPath: React.FC<{
  d: string;
  color: string;
  width: number;
  ctx: DrawCtx;
  opacity?: number;
  dash?: string;
  halo?: boolean;
}> = ({ d, color, width, ctx, opacity = 1, dash, halo = true }) => {
  if (!d) return null;
  const common = { d, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeDasharray: dash };
  return (
    <>
      {halo ? (
        <path {...common} stroke={ctx.palette.halo} strokeWidth={width + ctx.u * 0.7} opacity={ctx.palette.haloOpacity * opacity * 0.75} />
      ) : null}
      <path {...common} stroke={color} strokeWidth={width} opacity={opacity} />
    </>
  );
};

/** The glowing nib at the end of the line while something is being drawn - sells "live drawing". */
const PenTip: React.FC<{ tip: Pt | null; color: string; ctx: DrawCtx }> = ({ tip, color, ctx }) => {
  if (!tip) return null;
  const r = strokeWidth(ctx);
  return (
    <g>
      <circle cx={tip[0]} cy={tip[1]} r={r * 3.6} fill={color} opacity={0.16} />
      <circle cx={tip[0]} cy={tip[1]} r={r * 1.9} fill={color} opacity={0.35} />
      <circle cx={tip[0]} cy={tip[1]} r={r * 0.95} fill={ctx.palette.halo} opacity={0.95} />
    </g>
  );
};

/** Draws strokes progressively with the pen tip, in one call. */
const Sketch: React.FC<{
  strokes: Stroke[];
  progress: number;
  color: string;
  width: number;
  ctx: DrawCtx;
  opacity?: number;
  dash?: string;
  tip?: boolean;
  halo?: boolean;
}> = ({ strokes, progress, color, width, ctx, opacity, dash, tip = true, halo }) => {
  if (progress <= 0) return null;
  const p = partial(strokes, progress);
  return (
    <>
      <InkPath d={p.d} color={color} width={width} ctx={ctx} opacity={opacity} dash={dash} halo={halo} />
      {tip ? <PenTip tip={p.tip} color={color} ctx={ctx} /> : null}
    </>
  );
};

/**
 * Handwritten text: each line is revealed left-to-right through a soft-edged
 * mask that the pen tip leads, so letters "ink in" rather than fade.
 */
export const HandText: React.FC<{
  id: string;
  lines: string[];
  fontSize: number;
  x: number;
  y: number;
  align: "left" | "center";
  blockWidth: number;
  color: string;
  progress: number;
  ctx: DrawCtx;
  weight?: number;
}> = ({ id, lines, fontSize, x, y, align, blockWidth, color, progress, ctx, weight = 700 }) => {
  if (progress <= 0) return null;
  const lh = fontSize * LINE_HEIGHT_EM;
  const widths = lines.map((l) => estimateTextWidth(l, fontSize));
  const totalChars = lines.reduce((s, l) => s + Math.max(1, l.length), 0);
  const feather = fontSize * 0.7;
  const top = y;
  // Lines are written one after another, each getting time in proportion to its length.
  const lineProgress: number[] = [];
  for (let i = 0, consumed = 0; i < lines.length; i++) {
    const share = Math.max(1, lines[i].length) / totalChars;
    lineProgress.push(clamp01((progress - consumed) / share));
    consumed += share;
  }
  const leftOf = (i: number) => (align === "center" ? x + (blockWidth - widths[i]) / 2 : x);
  const baselineOf = (i: number) => top + lh * i + fontSize * 0.78;
  const writing = lineProgress.findIndex((lp) => lp > 0 && lp < 1);
  const tip: Pt | null =
    writing >= 0
      ? [
          Math.min(leftOf(writing) + widths[writing], leftOf(writing) + (widths[writing] + feather) * lineProgress[writing] - feather * 0.6),
          baselineOf(writing) - fontSize * (0.3 + 0.12 * Math.sin(ctx.frame * 1.7)),
        ]
      : null;

  const out = lines.map((line, i) => {
    const lp = lineProgress[i];
    if (lp <= 0) return null;
    const w = widths[i];
    const left = leftOf(i);
    const baseline = baselineOf(i);
    const revealX = left + (w + feather) * lp;
    const gid = `${safeId(id)}-g${i}`;
    const mid = `${safeId(id)}-m${i}`;
    const textProps = {
      x: align === "center" ? left + w / 2 : left,
      y: baseline,
      fontFamily: handFontFamily,
      fontWeight: weight,
      fontSize,
      textAnchor: align === "center" ? ("middle" as const) : ("start" as const),
    };
    return (
      <g key={i}>
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={revealX - feather} y1={0} x2={revealX} y2={0}>
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id={mid} maskUnits="userSpaceOnUse" x={0} y={0} width={ctx.width} height={ctx.height}>
            <rect
              x={left - fontSize}
              y={top + lh * i - fontSize * 0.6}
              width={lp >= 1 ? w * 2 + fontSize * 4 : Math.max(0, revealX - left + fontSize)}
              height={lh + fontSize * 1.2}
              fill={lp >= 1 ? "#fff" : `url(#${gid})`}
            />
          </mask>
        </defs>
        <g mask={`url(#${mid})`}>
          <text
            {...textProps}
            fill={color}
            stroke={ctx.palette.halo}
            strokeOpacity={ctx.palette.haloOpacity}
            strokeWidth={fontSize * 0.16}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {line}
          </text>
        </g>
      </g>
    );
  });
  return (
    <g>
      {out}
      <PenTip tip={tip} color={color} ctx={ctx} />
    </g>
  );
};

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

function buildShape(shape: NodeShape, b: Rect, r: Rand): Shape {
  switch (shape) {
    case "circle":
      return sketchEllipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, r);
    case "cylinder":
      return sketchCylinder(b.x, b.y, b.w, b.h, r);
    case "cloud":
      return sketchCloud(b.x, b.y, b.w, b.h, r);
    case "diamond":
      return sketchDiamond(b.x, b.y, b.w, b.h, r);
    case "doc":
      return sketchDoc(b.x, b.y, b.w, b.h, r);
    case "pill":
      return sketchRect(b.x, b.y, b.w, b.h, b.h / 2, r);
    default:
      return sketchRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.16, r);
  }
}

export const NodeView: React.FC<{ el: NodeElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = nodePhases(el, ctx.width, ctx.height);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const pOutline = p(ph.outline);
  const pFill = p(ph.fill);
  const pIcon = p(ph.icon);
  const pLabel = p(ph.label);
  const done = local >= el.duration;
  const accent = ctx.palette.accents[el.color];
  const sw = strokeWidth(ctx);
  const clipId = `clip-${safeId(el.id)}`;

  const r = rng(el.seed);
  const shape = buildShape(el.shape, el.box, r);
  const main = liven(shape.strokes, r, ctx, el.seed, ctx.u * 0.18, done);
  // Second, thinner pass slightly offset - the "went over it twice" marker look.
  const r2 = rng(el.seed + 101);
  const second = liven(buildShape(el.shape, el.box, r2).strokes, r2, ctx, el.seed + 5, ctx.u * 0.3, done);

  const content = nodeContentLayout(el.shape, el.box, !!el.icon);
  const hatch = hachure(el.box.x, el.box.y, el.box.w, el.box.h, ctx.u * 1.35, rng(el.seed + 7));
  const icon = el.icon && content.icon ? iconStrokes(el.icon, content.icon.x, content.icon.y, content.icon.size) : [];
  const iconLive = liven(icon, rng(el.seed + 13), ctx, el.seed + 9, ctx.u * 0.08, done);

  const textBlockH = el.lines.length * el.fontSize * LINE_HEIGHT_EM;
  const textY = content.text.y + (content.text.h - textBlockH) / 2;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <path d={`${toPath(shape.fill)}Z`} />
        </clipPath>
      </defs>
      {/* Paper backing so the drawing reads on any wall, then a fast hachure fill in the accent colour. */}
      <path d={`${toPath(shape.fill)}Z`} fill={ctx.palette.paper} opacity={ctx.palette.paperOpacity * smooth(clamp01(pOutline * 1.6 - 0.25))} />
      <g clipPath={`url(#${clipId})`}>
        <Sketch strokes={[hatch]} progress={pFill} color={accent} width={sw * 0.5} ctx={ctx} opacity={0.32} tip={false} halo={false} />
      </g>
      <Sketch strokes={second} progress={clamp01(pOutline * 1.15 - 0.15)} color={ctx.palette.ink} width={sw * 0.45} ctx={ctx} opacity={0.55} tip={false} halo={false} />
      <Sketch strokes={main} progress={pOutline} color={ctx.palette.ink} width={sw} ctx={ctx} />
      {iconLive.length > 0 ? <Sketch strokes={iconLive} progress={pIcon} color={accent} width={sw * 0.85} ctx={ctx} /> : null}
      <HandText
        id={el.id}
        lines={el.lines}
        fontSize={el.fontSize}
        x={content.text.x}
        y={textY}
        align="center"
        blockWidth={content.text.w}
        color={ctx.palette.ink}
        progress={pLabel}
        ctx={ctx}
      />
    </g>
  );
};

// ---------------------------------------------------------------------------
// Edge (arrow) + packet
// ---------------------------------------------------------------------------

export function edgeGeometry(el: EdgeElement, ctx: DrawCtx) {
  return edgeCurve(el.from, el.fromShape, el.to, el.toShape, el.bend, ctx.u * 1.6);
}

export const EdgeView: React.FC<{ el: EdgeElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = edgePhases(el, ctx.width, ctx.height);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const sw = strokeWidth(ctx);
  const r = rng(el.seed);
  const g = edgeGeometry(el, ctx);
  const len = Math.hypot(g.p1.x - g.p0.x, g.p1.y - g.p0.y);
  const shaft = liven([quad([g.p0.x, g.p0.y], [g.c.x, g.c.y], [g.p1.x, g.p1.y], Math.max(12, Math.ceil(len / 5)))], r, ctx, el.seed, ctx.u * 0.22, done);
  const headSize = Math.min(ctx.u * 2.8, len * 0.3);
  const heads: Stroke[] = [arrowHead([g.p1.x, g.p1.y], Math.atan2(g.p1.y - g.c.y, g.p1.x - g.c.x), headSize, r)];
  if (el.bidirectional) heads.push(arrowHead([g.p0.x, g.p0.y], Math.atan2(g.p0.y - g.c.y, g.p0.x - g.c.x), headSize, r));
  const headsLive = liven(heads, r, ctx, el.seed + 3, 0, done);

  let label: React.ReactNode = null;
  if (el.label && ph.label) {
    const m = quadPoint(g.p0, g.c, g.p1, 0.5);
    const nx = -(g.p1.y - g.p0.y) / (len || 1);
    const ny = (g.p1.x - g.p0.x) / (len || 1);
    const side = el.bend >= 0 ? 1 : -1;
    const off = el.fontSize * 0.75;
    const lw = estimateTextWidth(el.label, el.fontSize);
    const cx = m.x + nx * off * side;
    const cy = m.y + ny * off * side;
    label = (
      <HandText
        id={`${el.id}-label`}
        lines={[el.label]}
        fontSize={el.fontSize}
        x={cx - lw / 2}
        y={cy - (el.fontSize * LINE_HEIGHT_EM) / 2}
        align="center"
        blockWidth={lw}
        color={ctx.palette.accents[el.color]}
        progress={p(ph.label)}
        ctx={ctx}
        weight={700}
      />
    );
  }

  return (
    <g>
      <Sketch
        strokes={shaft}
        progress={p(ph.shaft)}
        color={ctx.palette.ink}
        width={sw * 0.9}
        ctx={ctx}
        dash={el.dashed ? `${ctx.u * 1.8} ${ctx.u * 1.5}` : undefined}
      />
      <Sketch strokes={headsLive} progress={p(ph.head)} color={ctx.palette.ink} width={sw * 0.9} ctx={ctx} tip={false} />
      {label}
    </g>
  );
};

/** A glowing dot (with a comet tail) travelling along an arrow: "data flows here". */
export const PacketView: React.FC<{ el: PacketElement; edge: EdgeElement | undefined; ctx: DrawCtx }> = ({ el, edge, ctx }) => {
  const local = ctx.frame - el.start;
  if (!edge || local < 0 || local >= el.duration) return null;
  const g = edgeGeometry(edge, ctx);
  const trip = Math.max(1, Math.round(PACKET_TRIP_SECONDS * ctx.fps));
  const t = (local % trip) / trip;
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
  const fade = Math.sin(Math.PI * t) ** 0.4;
  const color = ctx.palette.accents[el.color];
  const r = ctx.u * 1.15;
  const trail = Array.from({ length: 8 }, (_, i) => {
    const tt = Math.max(0, eased - (i + 1) * 0.028);
    const pt = quadPoint(g.p0, g.c, g.p1, tt);
    return <circle key={i} cx={pt.x} cy={pt.y} r={r * (1 - (i + 1) / 10)} fill={color} opacity={fade * 0.5 * (1 - (i + 1) / 9)} />;
  });
  const head = quadPoint(g.p0, g.c, g.p1, eased);
  return (
    <g>
      {trail}
      <circle cx={head.x} cy={head.y} r={r * 2.6} fill={color} opacity={0.22 * fade} />
      <circle cx={head.x} cy={head.y} r={r * 1.25} fill={color} opacity={fade} />
      <circle cx={head.x} cy={head.y} r={r * 0.55} fill="#ffffff" opacity={fade} />
    </g>
  );
};

// ---------------------------------------------------------------------------
// Marks (emphasis)
// ---------------------------------------------------------------------------

export const MarkView: React.FC<{ el: MarkElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const progress = smooth(clamp01(local / Math.max(1, el.duration)));
  const done = local >= el.duration;
  const r = rng(el.seed);
  const { x, y, w, h } = el.target;
  const u = ctx.u;
  const sw = strokeWidth(ctx);
  const color = ctx.palette.accents[el.color];
  let strokes: Stroke[] = [];
  let width = sw * 1.1;
  let opacity = 1;

  switch (el.mark) {
    case "circle": {
      const c = center(el.target);
      strokes = sketchEllipse(c.x, c.y, (w / 2) * 1.2 + u * 1.8, (h / 2) * 1.32 + u * 1.8, r, 1.18).strokes;
      break;
    }
    case "underline": {
      const yy = y + h + u * 1.6;
      strokes = [handLine([x + w * 0.06, yy], [x + w * 0.94, yy - u * 0.6], r, 0.05), handLine([x + w * 0.2, yy + u * 1.3], [x + w * 0.8, yy + u * 0.9], r, 0.06)];
      break;
    }
    case "highlight": {
      const c = center(el.target);
      strokes = [handLine([x + w * 0.1, c.y + h * 0.06], [x + w * 0.9, c.y - h * 0.02], r, 0.02)];
      width = h * 0.36;
      opacity = 0.42;
      break;
    }
    case "check": {
      const s = Math.min(h * 0.75, u * 8);
      const bx = x + w - s * 0.35;
      const by = y - s * 0.55;
      strokes = [[...handLine([bx, by + s * 0.55], [bx + s * 0.32, by + s * 0.9], r, 0.05), ...handLine([bx + s * 0.32, by + s * 0.9], [bx + s * 0.95, by], r, 0.05).slice(1)]];
      width = sw * 1.35;
      break;
    }
    case "cross": {
      strokes = [handLine([x - u, y - u], [x + w + u, y + h + u], r, 0.03), handLine([x + w + u, y - u], [x - u, y + h + u], r, 0.03)];
      width = sw * 1.3;
      break;
    }
    case "sparkle": {
      // Round shapes: anchor on the outline at 45deg, not the empty bounding-box corner.
      const ins = el.targetShape === "circle" || el.targetShape === "cloud" ? 0.15 : 0;
      const corners: [Pt, number][] = [
        [[x + w * (1 - ins) + u * 0.8, y + h * ins - u * 0.8], -Math.PI / 4],
        [[x + w * ins - u * 0.8, y + h * ins - u * 0.8], (-3 * Math.PI) / 4],
      ];
      for (const [[cx, cy], base] of corners) {
        for (const off of [-0.55, 0, 0.55]) {
          const a = base + off;
          const l = u * (off === 0 ? 5 : 3.6);
          strokes.push(handLine([cx + Math.cos(a) * u * 0.8, cy + Math.sin(a) * u * 0.8], [cx + Math.cos(a) * l, cy + Math.sin(a) * l], r, 0.03));
        }
      }
      break;
    }
    case "divider": {
      const a: Pt = [x, y];
      const b: Pt = [x + w, y + h];
      strokes = [handLine(a, b, r, 0.015)];
      width = sw * 0.8;
      opacity = 0.75;
      break;
    }
  }
  const live = liven(strokes, r, ctx, el.seed, el.mark === "highlight" ? 0 : u * 0.15, done);
  return (
    <Sketch
      strokes={live}
      progress={progress}
      color={el.mark === "divider" ? ctx.palette.ink : color}
      width={width}
      ctx={ctx}
      opacity={opacity}
      halo={el.mark !== "highlight"}
      dash={el.mark === "divider" ? `${u * 2} ${u * 1.6}` : undefined}
    />
  );
};

// ---------------------------------------------------------------------------
// Title / note
// ---------------------------------------------------------------------------

function rectEdgePoint(rect: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  return boundaryPoint("box", rect, toward.x, toward.y, 0);
}

export const TextView: React.FC<{ el: TextElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = textPhases(el);
  const p = (phase: Phase) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const accent = ctx.palette.accents[el.color];
  const r = rng(el.seed);
  const u = ctx.u;
  const lh = el.fontSize * LINE_HEIGHT_EM;
  const blockH = el.lines.length * lh;

  let extra: React.ReactNode = null;
  if (el.variant === "title") {
    const yy = el.y + blockH + u * 0.6;
    const swoosh = [handLine([el.x - u, yy + u * 0.4], [el.x + el.blockWidth + u, yy - u * 0.3], r, 0.04)];
    extra = <Sketch strokes={liven(swoosh, r, ctx, el.seed, u * 0.2, done)} progress={p(ph.extra)} color={accent} width={strokeWidth(ctx) * 1.15} ctx={ctx} />;
  } else if (el.pointTo) {
    const noteRect = { x: el.x - u * 0.5, y: el.y - u * 0.3, w: el.blockWidth + u, h: blockH + u * 0.6 };
    const target = center(el.pointTo);
    const a = rectEdgePoint(noteRect, target);
    const b = boundaryPoint("box", el.pointTo, a.x, a.y, u * 1.2);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bend = (r() > 0.5 ? 1 : -1) * 0.28;
    const c = { x: (a.x + b.x) / 2 - ((b.y - a.y) / (len || 1)) * bend * len, y: (a.y + b.y) / 2 + ((b.x - a.x) / (len || 1)) * bend * len };
    const shaft = quad([a.x, a.y], [c.x, c.y], [b.x, b.y], Math.max(10, Math.ceil(len / 5)));
    const head = arrowHead([b.x, b.y], Math.atan2(b.y - c.y, b.x - c.x), Math.min(u * 2.2, len * 0.35), r);
    extra = <Sketch strokes={liven([shaft, head], r, ctx, el.seed, u * 0.12, done)} progress={p(ph.extra)} color={accent} width={strokeWidth(ctx) * 0.85} ctx={ctx} />;
  }

  return (
    <g>
      <HandText
        id={el.id}
        lines={el.lines}
        fontSize={el.fontSize}
        x={el.x}
        y={el.y}
        align={el.align}
        blockWidth={el.blockWidth}
        color={el.variant === "title" ? ctx.palette.ink : accent}
        progress={p(ph.write)}
        ctx={ctx}
      />
      {extra}
    </g>
  );
};
