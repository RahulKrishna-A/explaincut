import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { EdgeElement, RenderPlan, RenderScene } from "@/types/diagramPlan";
import { EdgeView, MarkView, NodeView, PacketView, TextView, type DrawCtx } from "./sketch/elements";
import { PALETTES } from "./sketch/theme";

const ERASE_SECONDS = 0.45;
/** Paint order inside a scene: arrows tuck under boxes, emphasis and notes sit on top. */
const Z: Record<string, number> = { edge: 0, packet: 1, node: 2, mark: 3, text: 4 };

const SceneLayer: React.FC<{ scene: RenderScene; ctx: DrawCtx }> = ({ scene, ctx }) => {
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

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="sketch-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx={0} dy={u * 0.3} stdDeviation={u * 0.45} floodColor="#000" floodOpacity={palette.shadowOpacity} />
        </filter>
      </defs>
      {showRegions
        ? plan.regions.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(0,200,255,0.08)" stroke="#00c8ff" strokeDasharray="8 6" strokeWidth={2} />
          ))
        : null}
      <g filter="url(#sketch-shadow)">
        {plan.scenes.map((scene) => (
          <SceneLayer key={scene.id} scene={scene} ctx={ctx} />
        ))}
      </g>
    </svg>
  );
};
