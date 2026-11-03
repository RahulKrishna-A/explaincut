import type { DiagramOpType, ResolvedDiagramOp } from "@/types/diagramPlan";

export function opsForTarget(
  ops: ResolvedDiagramOp[],
  targetId: string,
  types: DiagramOpType[]
): ResolvedDiagramOp[] {
  return ops.filter((op) => op.targetId === targetId && types.includes(op.type));
}

export interface OpTrigger {
  frame: number;
  durationFrames: number;
}

/** The earliest matching op's trigger frame + duration, or null if never triggered. */
export function earliestTrigger(ops: ResolvedDiagramOp[]): OpTrigger | null {
  if (ops.length === 0) return null;
  const earliest = ops.reduce((a, b) => (b.frame < a.frame ? b : a));
  return { frame: earliest.frame, durationFrames: earliest.durationFrames };
}

/** True once the frame has passed the most recent matching op's trigger frame. */
export function isActive(frame: number, ops: ResolvedDiagramOp[]): boolean {
  return ops.some((op) => frame >= op.frame);
}
