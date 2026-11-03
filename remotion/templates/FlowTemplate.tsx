import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { ResolvedDiagramPlan } from "@/types/diagramPlan";
import { NodeBox } from "./shared/Node";
import { EdgeLine } from "./shared/Edge";
import { earliestTrigger, isActive, opsForTarget } from "./shared/useTimedVisibility";

export const FlowTemplate: React.FC<{ plan: ResolvedDiagramPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const sortedNodes = [...plan.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const n = sortedNodes.length;
  const isPortrait = height > width;

  // Node box size and the axis step both scale with the actual frame, so
  // boxes never overlap or clip regardless of the source video's aspect
  // ratio - landscape webcam, portrait phone selfie, or anything between.
  let nodeWidth: number;
  let nodeHeight: number;
  const positions = new Map<string, { x: number; y: number }>();

  if (isPortrait) {
    nodeWidth = Math.min(340, width * 0.78);
    nodeHeight = Math.max(56, height * 0.07);
    const margin = height * 0.1;
    const usableHeight = height - margin * 2;
    const step = n > 1 ? usableHeight / (n - 1) : 0;
    const centerX = width / 2;
    sortedNodes.forEach((node, i) => {
      const x = node.position ? node.position.x * width : centerX;
      const y = node.position ? node.position.y * height : margin + step * i;
      positions.set(node.id, { x, y });
    });
  } else {
    const margin = width * 0.12;
    const usableWidth = width - margin * 2;
    const step = n > 1 ? usableWidth / (n - 1) : 0;
    nodeWidth = Math.min(220, step > 0 ? step * 0.85 : width * 0.3);
    nodeHeight = Math.max(64, height * 0.1);
    const centerY = height / 2;
    sortedNodes.forEach((node, i) => {
      const x = node.position ? node.position.x * width : margin + step * i;
      const y = node.position ? node.position.y * height : centerY;
      positions.set(node.id, { x, y });
    });
  }

  return (
    <>
      {plan.edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        const trigger = earliestTrigger(opsForTarget(plan.ops, edge.id, ["showEdge"]));
        return <EdgeLine key={edge.id} edge={edge} from={from} to={to} trigger={trigger} />;
      })}
      {sortedNodes.map((node) => {
        const pos = positions.get(node.id)!;
        const trigger = earliestTrigger(opsForTarget(plan.ops, node.id, ["showNode"]));
        const highlightOps = opsForTarget(plan.ops, node.id, ["highlightNode"]);
        const highlighted = isActive(frame, highlightOps);
        return (
          <NodeBox
            key={node.id}
            node={node}
            x={pos.x - nodeWidth / 2}
            y={pos.y - nodeHeight / 2}
            width={nodeWidth}
            height={nodeHeight}
            trigger={trigger}
            highlighted={highlighted}
          />
        );
      })}
    </>
  );
};
