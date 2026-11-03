import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { DiagramEdge } from "@/types/diagramPlan";
import { diagramFontFamily } from "../../fonts";
import type { OpTrigger } from "./useTimedVisibility";

interface EdgeLineProps {
  edge: DiagramEdge;
  from: { x: number; y: number };
  to: { x: number; y: number };
  trigger: OpTrigger | null;
}

const LINE_LENGTH_ESTIMATE = 2000; // comfortably longer than any on-screen edge
const DEFAULT_COLOR = "#a5b4fc"; // indigo-300

export const EdgeLine: React.FC<EdgeLineProps> = ({ edge, from, to, trigger }) => {
  const frame = useCurrentFrame();
  if (!trigger || frame < trigger.frame) return null;

  const local = frame - trigger.frame;
  const drawFrames = Math.max(4, trigger.durationFrames);
  // Eased dash-reveal, like a hand drawing the line from tail to head - the
  // arrowhead only appears once the stroke actually reaches the tip, instead
  // of sitting there from frame one (SVG markers ignore dash visibility).
  const drawProgress = interpolate(local, [0, drawFrames], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (drawProgress <= 0.001) return null;

  const color = edge.style?.color ?? DEFAULT_COLOR;
  const dashOffset = LINE_LENGTH_ESTIMATE * (1 - drawProgress);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const showArrowhead = drawProgress > 0.92;
  const labelOpacity = interpolate(drawProgress, [0.75, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>
      <defs>
        <marker
          id={`arrow-${edge.id}`}
          markerWidth="9"
          markerHeight="9"
          refX="5.5"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={color} />
        </marker>
      </defs>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={edge.style?.dashed ? "8 6" : LINE_LENGTH_ESTIMATE}
        strokeDashoffset={edge.style?.dashed ? undefined : dashOffset}
        opacity={0.85}
        markerEnd={showArrowhead ? `url(#arrow-${edge.id})` : undefined}
      />
      {edge.label && labelOpacity > 0 ? (
        <text
          x={midX}
          y={midY - 10}
          fill={color}
          fontSize={15}
          fontFamily={diagramFontFamily}
          fontWeight={600}
          textAnchor="middle"
          opacity={labelOpacity}
        >
          {edge.label}
        </text>
      ) : null}
    </svg>
  );
};
