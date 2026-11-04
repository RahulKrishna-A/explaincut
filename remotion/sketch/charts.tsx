/**
 * Hand-drawn charts. Every part is drawn live by the same "pen" as the rest of
 * the sketch: axes are ruled in with arrowheads, bars grow up from the
 * baseline and get hatched in, a line chart is traced point to point, donut
 * slices sweep round - and values are written in by hand as they land.
 */
import React from "react";
import type { AxesElement, BarElement, PointElement, SliceElement } from "@/types/diagramPlan";
import { axesPhases, barPhases, pointPhases, slicePhases, type Phase } from "@/lib/layout/timing";
import { arrowHead, hachure, handLine, rng, sketchRect, toPath, type Pt, type Stroke } from "./rough";
import { HandText, InkPath, Sketch, clamp01, liven, phaseProgress, safeId, smooth, strokeWidth, type DrawCtx } from "./elements";

const linesOf = (s: string) => s.split("\n").filter(Boolean);

export const AxesView: React.FC<{ el: AxesElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = axesPhases(el, ctx.width, ctx.height);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const u = ctx.u;
  const sw = strokeWidth(ctx);
  const r = rng(el.seed);
  const { plot, card } = el;
  const base = plot.y + plot.h;

  const yTop: Pt = [plot.x, plot.y - u * 1.8];
  const xEnd: Pt = [plot.x + plot.w + u * 1.2, base];
  const yAxis: Stroke[] = [handLine([plot.x, base + u * 0.4], yTop, r, 0.01), arrowHead(yTop, -Math.PI / 2, u * 1.8, r)];
  const xAxis: Stroke[] = [handLine([plot.x - u * 0.4, base], xEnd, r, 0.008), arrowHead(xEnd, 0, u * 1.8, r)];
  const grid: Stroke[] = el.grid.map((g) => handLine([plot.x + u * 0.6, base - g * plot.h], [plot.x + plot.w, base - g * plot.h], r, 0.004));

  return (
    <g>
      <rect
        x={card.x}
        y={card.y}
        width={card.w}
        height={card.h}
        rx={u * 2.2}
        fill={ctx.palette.paper}
        opacity={ctx.palette.paperOpacity * 0.72 * smooth(p(ph.card))}
      />
      <Sketch
        strokes={liven(grid, r, ctx, el.seed + 2, 0, false)}
        progress={p(ph.grid)}
        color={ctx.palette.ink}
        width={sw * 0.4}
        ctx={ctx}
        opacity={0.28}
        dash={`${u * 1.1} ${u * 1.1}`}
        tip={false}
        halo={false}
      />
      <Sketch strokes={liven(yAxis, r, ctx, el.seed, u * 0.1, done)} progress={p(ph.yAxis)} color={ctx.palette.ink} width={sw * 0.9} ctx={ctx} />
      <Sketch strokes={liven(xAxis, r, ctx, el.seed + 1, u * 0.1, done)} progress={p(ph.xAxis)} color={ctx.palette.ink} width={sw * 0.9} ctx={ctx} />
      {el.yLabel && ph.label ? (
        <HandText
          id={`${el.id}-ylabel`}
          lines={[el.yLabel]}
          fontSize={el.fontSize}
          x={plot.x + u * 1.6}
          y={card.y + u * 1.4}
          align="left"
          blockWidth={plot.w}
          color={ctx.palette.accents.purple}
          progress={p(ph.label)}
          ctx={ctx}
        />
      ) : null}
    </g>
  );
};

export const BarView: React.FC<{ el: BarElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = barPhases(el);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const u = ctx.u;
  const sw = strokeWidth(ctx);
  const accent = ctx.palette.accents[el.color];
  const g = smooth(p(ph.grow));
  const { bar } = el;
  const cur =
    el.orientation === "vertical"
      ? { x: bar.x, y: bar.y + bar.h * (1 - g), w: bar.w, h: bar.h * g }
      : { x: bar.x, y: bar.y, w: bar.w * g, h: bar.h };
  const clipId = `clip-${safeId(el.id)}`;
  const r = rng(el.seed);
  const outline = g > 0.01 ? liven(sketchRect(cur.x, cur.y, cur.w, cur.h, Math.min(cur.w, cur.h, u * 1.2) * 0.25, r).strokes, r, ctx, el.seed, u * 0.12, done) : [];
  const hatch = hachure(bar.x, bar.y, bar.w, bar.h, u * 1.15, rng(el.seed + 7));
  // While growing, the pen rides the leading edge of the bar.
  const tip: Pt | null =
    g > 0 && g < 1 ? (el.orientation === "vertical" ? [cur.x + cur.w * 0.5, cur.y] : [cur.x + cur.w, cur.y + cur.h * 0.5]) : null;
  const label = linesOf(el.label);

  return (
    <g>
      <HandText
        id={`${el.id}-label`}
        lines={label}
        fontSize={el.fontSize}
        x={el.labelAt.x}
        y={el.labelAt.y}
        align={el.labelAt.align}
        blockWidth={el.labelAt.w}
        color={ctx.palette.ink}
        progress={p(ph.label)}
        ctx={ctx}
      />
      {g > 0.01 ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect x={cur.x} y={cur.y} width={cur.w} height={cur.h} />
            </clipPath>
          </defs>
          <rect x={cur.x} y={cur.y} width={cur.w} height={cur.h} fill={ctx.palette.paper} opacity={ctx.palette.paperOpacity} />
          <rect x={cur.x} y={cur.y} width={cur.w} height={cur.h} fill={accent} opacity={0.3} />
          <g clipPath={`url(#${clipId})`}>
            <Sketch strokes={[hatch]} progress={p(ph.fill)} color={accent} width={sw * 0.55} ctx={ctx} opacity={0.75} tip={false} halo={false} />
          </g>
          <InkPath d={outline.map((s) => toPath(s)).join(" ")} color={ctx.palette.ink} width={sw} ctx={ctx} />
          {tip ? <circle cx={tip[0]} cy={tip[1]} r={sw * 1.5} fill={accent} opacity={0.5} /> : null}
        </>
      ) : null}
      {el.value && el.valueAt && ph.value ? (
        <HandText
          id={`${el.id}-value`}
          lines={[el.value]}
          fontSize={el.fontSize * 1.08}
          x={el.valueAt.x}
          y={el.valueAt.y}
          align={el.valueAt.align}
          blockWidth={el.valueAt.w}
          color={accent}
          progress={p(ph.value)}
          ctx={ctx}
        />
      ) : null}
    </g>
  );
};

export const PointView: React.FC<{ el: PointElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = pointPhases(el, ctx.width, ctx.height);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const u = ctx.u;
  const sw = strokeWidth(ctx);
  const accent = ctx.palette.accents[el.color];
  const r = rng(el.seed);
  const pSeg = p(ph.segment);
  const pDot = smooth(p(ph.dot));

  let segment: React.ReactNode = null;
  if (el.prev && ph.segment && pSeg > 0) {
    const a: Pt = [el.prev.x, el.prev.y];
    const b: Pt = [el.at.x, el.at.y];
    const end: Pt = [a[0] + (b[0] - a[0]) * pSeg, a[1] + (b[1] - a[1]) * pSeg];
    // Soft area under the line, growing with it.
    const area = `M${a[0]},${a[1]} L${end[0]},${end[1]} L${end[0]},${el.baseline} L${a[0]},${el.baseline} Z`;
    segment = (
      <>
        <path d={area} fill={accent} opacity={0.16} />
        <Sketch strokes={liven([handLine(a, b, r, 0.015)], r, ctx, el.seed, u * 0.1, done)} progress={pSeg} color={accent} width={sw * 1.25} ctx={ctx} />
      </>
    );
  }
  const tick = handLine([el.at.x, el.baseline - u * 0.8], [el.at.x, el.baseline + u * 0.8], r, 0);

  return (
    <g>
      <Sketch strokes={[tick]} progress={p(ph.label)} color={ctx.palette.ink} width={sw * 0.7} ctx={ctx} tip={false} />
      <HandText
        id={`${el.id}-label`}
        lines={linesOf(el.label)}
        fontSize={el.fontSize}
        x={el.labelAt.x}
        y={el.labelAt.y}
        align="center"
        blockWidth={el.labelAt.w}
        color={ctx.palette.ink}
        progress={p(ph.label)}
        ctx={ctx}
      />
      {segment}
      {pDot > 0 ? (
        <g>
          <circle cx={el.at.x} cy={el.at.y} r={u * 1.9 * pDot} fill={ctx.palette.halo} opacity={ctx.palette.haloOpacity} />
          <circle cx={el.at.x} cy={el.at.y} r={u * 1.35 * pDot} fill={accent} />
          <circle cx={el.at.x} cy={el.at.y} r={u * 0.55 * pDot} fill={ctx.palette.paper} />
        </g>
      ) : null}
      {el.value && el.valueAt && ph.value ? (
        <HandText
          id={`${el.id}-value`}
          lines={[el.value]}
          fontSize={el.fontSize * 1.08}
          x={el.valueAt.x}
          y={el.valueAt.y}
          align="center"
          blockWidth={el.valueAt.w}
          color={accent}
          progress={p(ph.value)}
          ctx={ctx}
        />
      ) : null}
    </g>
  );
};

const polar = (cx: number, cy: number, r: number, a: number): Pt => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r) / 6));
  return Array.from({ length: n + 1 }, (_, i) => polar(cx, cy, r, a0 + ((a1 - a0) * i) / n));
}

export const SliceView: React.FC<{ el: SliceElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const local = ctx.frame - el.start;
  if (local < 0) return null;
  const ph = slicePhases(el);
  const p = (phase: Phase | null) => phaseProgress(local, el.duration, ph.total, ctx.fps, phase);
  const done = local >= el.duration;
  const sw = strokeWidth(ctx);
  const accent = ctx.palette.accents[el.color];
  const r = rng(el.seed);
  const sweep = smooth(p(ph.sweep));
  const a1 = el.a0 + (el.a1 - el.a0) * sweep;
  const { cx, cy } = el;

  let wedge: React.ReactNode = null;
  if (sweep > 0.002) {
    const outer = arcPts(cx, cy, el.r, el.a0, a1);
    const inner = arcPts(cx, cy, el.inner, a1, el.a0);
    const fillD = `${toPath([...outer, ...inner])}Z`;
    const edge: Stroke = [polar(cx, cy, el.inner, el.a0), polar(cx, cy, el.r, el.a0)];
    const fillP = clamp01(p(ph.fill));
    wedge = (
      <>
        <path d={fillD} fill={ctx.palette.paper} opacity={ctx.palette.paperOpacity} />
        <path d={fillD} fill={accent} opacity={0.2 + 0.55 * fillP} />
        <InkPath d={toPath(liven([edge], r, ctx, el.seed + 1, 0, done)[0])} color={ctx.palette.ink} width={sw * 0.8} ctx={ctx} />
        <Sketch strokes={liven([outer], r, ctx, el.seed, ctx.u * 0.08, done)} progress={1} color={ctx.palette.ink} width={sw} ctx={ctx} tip={sweep < 1} />
        <Sketch strokes={[inner]} progress={1} color={ctx.palette.ink} width={sw * 0.6} ctx={ctx} opacity={0.6} tip={false} halo={false} />
      </>
    );
  }

  const leader = el.leader
    ? [handLine([el.leader.from.x, el.leader.from.y], [el.leader.to.x, el.leader.to.y], r, 0)]
    : [];

  return (
    <g>
      {wedge}
      {leader.length ? <Sketch strokes={leader} progress={p(ph.leader)} color={accent} width={sw * 0.8} ctx={ctx} tip={false} /> : null}
      <HandText
        id={`${el.id}-label`}
        lines={el.lines}
        fontSize={el.fontSize}
        x={el.labelAt.x}
        y={el.labelAt.y}
        align={el.labelAt.align}
        blockWidth={el.labelAt.w}
        color={ctx.palette.ink}
        progress={p(ph.label)}
        ctx={ctx}
      />
    </g>
  );
};
