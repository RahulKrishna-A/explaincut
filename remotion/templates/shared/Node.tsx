import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { DiagramNode } from "@/types/diagramPlan";
import { diagramFontFamily } from "../../fonts";
import type { OpTrigger } from "./useTimedVisibility";

interface NodeBoxProps {
  node: DiagramNode;
  x: number;
  y: number;
  width: number;
  height: number;
  trigger: OpTrigger | null;
  highlighted: boolean;
}

const DEFAULT_COLOR = "#818cf8"; // indigo-400
const HIGHLIGHT_COLOR = "#fbbf24"; // amber-400

export const NodeBox: React.FC<NodeBoxProps> = ({
  node,
  x,
  y,
  width,
  height,
  trigger,
  highlighted,
}) => {
  const frame = useCurrentFrame();
  if (!trigger || frame < trigger.frame) return null;

  const local = frame - trigger.frame;
  const drawFrames = Math.max(4, trigger.durationFrames);
  // The outline "draws" itself first (like a pen tracing the box), then the
  // fill and label settle in as the stroke finishes - not a fixed box
  // popping into place.
  const drawProgress = interpolate(local, [0, drawFrames * 0.7], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fillProgress = interpolate(local, [drawFrames * 0.35, drawFrames * 1.05], [0, 1], {
    easing: Easing.out(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (drawProgress <= 0.001) return null;

  const color = highlighted ? HIGHLIGHT_COLOR : (node.style?.color ?? DEFAULT_COLOR);
  const radius = node.kind === "pill" ? height / 2 : 14;
  const fontSize = Math.max(12, Math.min(22, width / 9, height * 0.3));
  const w = Math.max(1, width - 3);
  const h = Math.max(1, height - 3);
  const perimeter = 2 * (w + h);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        filter: highlighted
          ? `drop-shadow(0 0 ${10 * fillProgress}px ${color}aa)`
          : `drop-shadow(0 0 ${6 * fillProgress}px ${color}55)`,
      }}
    >
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <rect
          x={1.5}
          y={1.5}
          width={w}
          height={h}
          rx={radius}
          ry={radius}
          fill="rgb(18,20,32)"
          fillOpacity={0.9 * fillProgress}
          stroke={color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeDasharray={perimeter}
          strokeDashoffset={perimeter * (1 - drawProgress)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: fillProgress,
          color: "#f5f7ff",
          fontFamily: diagramFontFamily,
          fontSize,
          lineHeight: 1.15,
          fontWeight: 700,
          letterSpacing: -0.2,
          textAlign: "center",
          padding: "0 10px",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {node.label}
      </div>
    </div>
  );
};
