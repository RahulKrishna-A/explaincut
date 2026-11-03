import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { ResolvedDiagramPlan } from "@/types/diagramPlan";
import { NodeBox } from "./shared/Node";
import { earliestTrigger, isActive, opsForTarget } from "./shared/useTimedVisibility";

export const LayersTemplate: React.FC<{ plan: ResolvedDiagramPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const sortedNodes = [...plan.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const n = sortedNodes.length;

  // Fit the stack to whatever vertical space is actually available, so it
  // never overflows a short landscape frame or looks tiny in a tall one.
  const availableHeight = height * 0.8;
  const gap = Math.max(12, Math.min(24, availableHeight * 0.03));
  const layerHeight = Math.max(
    44,
    Math.min(80, (availableHeight - gap * Math.max(0, n - 1)) / Math.max(1, n))
  );
  const totalHeight = n * layerHeight + Math.max(0, n - 1) * gap;
  const startY = (height - totalHeight) / 2;
  const layerWidth = Math.min(640, width * 0.78);
  const x = (width - layerWidth) / 2;

  return (
    <>
      {sortedNodes.map((node, i) => {
        const trigger = earliestTrigger(opsForTarget(plan.ops, node.id, ["showNode"]));
        const highlightOps = opsForTarget(plan.ops, node.id, ["highlightNode"]);
        const highlighted = isActive(frame, highlightOps);
        const y = startY + i * (layerHeight + gap);

        return (
          <NodeBox
            key={node.id}
            node={node}
            x={x}
            y={y}
            width={layerWidth}
            height={layerHeight}
            trigger={trigger}
            highlighted={highlighted}
          />
        );
      })}
    </>
  );
};
