import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { EdgeElement, RenderPlan, RenderScene } from "@/types/diagramPlan";
import { EdgeView, MarkView, NodeView, PacketView, TextView, type DrawCtx } from "./sketch/elements";
import { AxesView, BarView, PointView, SliceView } from "./sketch/charts";
import { PALETTES } from "./sketch/theme";
import { StickerView, usePreloadStickers } from "./sketch/sticker";
import { toneProfile } from "@/lib/style/tone";
import { boardFrameWindows, boardOpacity } from "@/lib/layout/board";

const ERASE_SECONDS = 0.45;
/** Paint order inside a scene: arrows tuck under boxes, emphasis and notes sit on top. */
const Z: Record<string, number> = { axes: -1, edge: 0, packet: 1, node: 2, bar: 2, point: 2, slice: 2, mark: 3, sticker: 3.5, text: 4 };

const SceneLayer: React.FC<{ scene: RenderScene; ctx: DrawCtx }> = ({ scene, ctx: baseCtx }) => {
  // Everything in the scene moves with the energy of the speaker's tone.
  const ctx: DrawCtx = { ...baseCtx, energy: toneProfile(scene.tone).energy };
  const { frame, fps, u } = ctx;
  if (frame < scene.start || frame >= scene.end) return null;
  const eraseFrames = Math.round(ERASE_SECONDS * fps);
  // Scene change: the whole drawing lifts, blurs and fades - like a quick whiteboard wipe.
  const e = interpolate(frame, [scene.end - eraseFrames, scene.end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const edges = new Map(scene.elements.filter((el): el is EdgeElement => el.kind === "edge").map((el) => [el.id, el]));
  const ordered = [...scene.elements].sort((a, b) => Z[a.kind] - Z[b.kind] || a.start - b.start);

  return (
    <g
      opacity={1 - e}
      transform={`translate(0 ${-e * u * 2.5})`}
      style={e > 0 ? { filter: `blur(${(e * u * 0.5).toFixed(2)}px)` } : undefined}
    >
      {ordered.map((el) => {
        switch (el.kind) {
          case "node":
            return <NodeView key={el.id} el={el} ctx={ctx} />;
          case "edge":
            return <EdgeView key={el.id} el={el} ctx={ctx} />;
          case "packet":
            return <PacketView key={el.id} el={el} edge={edges.get(el.edgeId)} ctx={ctx} />;
          case "mark":
            return <MarkView key={el.id} el={el} ctx={ctx} />;
          case "text":
            return <TextView key={el.id} el={el} ctx={ctx} />;
          case "axes":
            return <AxesView key={el.id} el={el} ctx={ctx} />;
          case "bar":
            return <BarView key={el.id} el={el} ctx={ctx} />;
          case "point":
            return <PointView key={el.id} el={el} ctx={ctx} />;
          case "slice":
            return <SliceView key={el.id} el={el} ctx={ctx} />;
          case "sticker":
            return <StickerView key={el.id} el={el} ctx={ctx} />;
          default:
            return null;
        }
      })}
    </g>
  );
};

export const SketchRenderer: React.FC<{ plan: RenderPlan; showRegions?: boolean }> = ({ plan, showRegions }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = plan;
  const u = Math.min(width, height) / 100;
  const palette = PALETTES[plan.theme] ?? PALETTES.ink;
  const ctx: DrawCtx = { frame, fps, width, height, u, palette };
  // On the black board the ink is always light, whatever the speaker's wall looked like.
  const boardCtx: DrawCtx = { ...ctx, palette: PALETTES.chalk };
  const backdrop = boardOpacity(boardFrameWindows(plan), frame, fps);
  usePreloadStickers([...new Set(plan.scenes.flatMap((s) => s.elements.flatMap((el) => (el.kind === "sticker" ? [el.src] : []))))]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="sketch-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx={0} dy={u * 0.3} stdDeviation={u * 0.45} floodColor="#000" floodOpacity={palette.shadowOpacity} />
        </filter>
        <filter id="board-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx={0} dy={u * 0.3} stdDeviation={u * 0.45} floodColor="#000" floodOpacity={boardCtx.palette.shadowOpacity} />
        </filter>
      </defs>
      {showRegions
        ? plan.regions.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(0,200,255,0.08)" stroke="#00c8ff" strokeDasharray="8 6" strokeWidth={2} />
          ))
        : null}
      <g filter="url(#sketch-shadow)">
        {plan.scenes
          .filter((scene) => !scene.board)
          .map((scene) => (
            <SceneLayer key={scene.id} scene={scene} ctx={ctx} />
          ))}
      </g>
      {/* The black board: the speaker scene dissolves under it, the board scene draws on top. */}
      {backdrop > 0 ? <rect x={0} y={0} width={width} height={height} fill="#000" opacity={backdrop} /> : null}
      <g filter="url(#board-shadow)">
        {plan.scenes
          .filter((scene) => scene.board)
          .map((scene) => (
            <SceneLayer key={scene.id} scene={scene} ctx={boardCtx} />
          ))}
      </g>
    </svg>
  );
};
