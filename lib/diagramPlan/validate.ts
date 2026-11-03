import { diagramPlanSchema } from "./schema";
import type { Transcript } from "@/types/transcript";
import type {
  DiagramOp,
  DiagramPlan,
  DiagramScene,
  ResolvedDiagramOp,
  ResolvedDiagramPlan,
  ResolvedDiagramScene,
} from "@/types/diagramPlan";

const FUZZY_MATCH_WINDOW = 8; // words to search left/right of the claimed index

export interface ValidationIssue {
  opId: string;
  reason: string;
}

export interface ValidationResult {
  plan: ResolvedDiagramPlan;
  issues: ValidationIssue[];
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Finds the real timestamp for an op's trigger word. The model's own
 * timestampSeconds is never trusted - only wordIndex + a fuzzy text match
 * against the real ASR transcript locate the authoritative time.
 */
function resolveTriggerSeconds(op: DiagramOp, transcript: Transcript): number | null {
  const words = transcript.words;
  if (words.length === 0) return null;

  const claimedIndex = Math.min(Math.max(op.trigger.wordIndex, 0), words.length - 1);
  const target = normalizeWord(op.trigger.word);
  const matches = (i: number) => {
    const w = normalizeWord(words[i].word);
    return w === target || (target.length >= 4 && (w.startsWith(target) || target.startsWith(w)) && w.length >= 3);
  };

  if (matches(claimedIndex)) return words[claimedIndex].startSeconds;

  for (let offset = 1; offset <= FUZZY_MATCH_WINDOW; offset++) {
    const right = claimedIndex + offset;
    const left = claimedIndex - offset;
    if (right < words.length && matches(right)) return words[right].startSeconds;
    if (left >= 0 && matches(left)) return words[left].startSeconds;
  }

  // No textual match nearby - fall back to the claimed index's own timing.
  return words[claimedIndex].startSeconds;
}

const NODE_TARGET_OPS = new Set(["draw", "circle", "underline", "highlight", "check", "cross", "sparkle"]);
const EDGE_TARGET_OPS = new Set(["connect", "flow"]);

function checkOp(op: DiagramOp, scene: DiagramScene, nodeIds: Set<string>, edgeIds: Set<string>): string | null {
  if (NODE_TARGET_OPS.has(op.type)) {
    return op.target && nodeIds.has(op.target) ? null : `node "${op.target}" not found in scene ${scene.id}`;
  }
  if (EDGE_TARGET_OPS.has(op.type)) {
    return op.target && edgeIds.has(op.target) ? null : `edge "${op.target}" not found in scene ${scene.id}`;
  }
  if (op.type === "title" || op.type === "note") {
    if (!op.text?.trim()) return `${op.type} op has no text`;
    if (op.type === "note" && op.target && !nodeIds.has(op.target)) {
      // A note pointing at a missing node is still worth writing - just unanchored.
      op.target = undefined;
    }
    return null;
  }
  return `unknown op type ${op.type}`;
}

/**
 * Validates and resolves a raw v2 plan against the real transcript. Never
 * throws on a single bad op/edge - they are dropped so one hallucination
 * can't take down the whole render. Throws only if the plan's overall shape
 * is wrong (so the caller can retry the model).
 */
export function validateAndResolveDiagramPlan(rawPlan: unknown, transcript: Transcript): ValidationResult {
  const parsed = diagramPlanSchema.parse(rawPlan) as DiagramPlan;
  const issues: ValidationIssue[] = [];
  const fps = parsed.fps;
  const durationSeconds = transcript.durationSeconds || parsed.durationSeconds;

  const scenes: ResolvedDiagramScene[] = [];
  for (const scene of parsed.scenes) {
    // De-duplicate node ids (keep first) - the layout keys off them.
    const seen = new Set<string>();
    const nodes = scene.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
    const nodeIds = new Set(nodes.map((n) => n.id));

    const edges = scene.edges.filter((edge) => {
      const ok = nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to;
      if (!ok) issues.push({ opId: edge.id, reason: "edge references unknown node id" });
      return ok;
    });
    const edgeIds = new Set(edges.map((e) => e.id));

    const ops: ResolvedDiagramOp[] = [];
    for (const op of scene.ops) {
      const problem = checkOp(op, scene, nodeIds, edgeIds);
      if (problem) {
        issues.push({ opId: op.id, reason: problem });
        continue;
      }
      const seconds = resolveTriggerSeconds(op, transcript);
      if (seconds === null) {
        issues.push({ opId: op.id, reason: "transcript has no words to anchor to" });
        continue;
      }
      ops.push({
        ...op,
        trigger: { ...op.trigger, timestampSeconds: seconds },
        frame: Math.round(seconds * fps),
      });
    }

    if (nodes.length === 0 && ops.length === 0) continue;
    ops.sort((a, b) => a.frame - b.frame);
    scenes.push({ ...scene, nodes, edges, ops });
  }

  // Last resort: nothing resolved at all - spread scenes evenly so we never
  // ship an empty video.
  if (scenes.every((s) => s.ops.length === 0)) {
    const totalFrames = Math.round(durationSeconds * fps);
    scenes.forEach((scene, si) => {
      const sceneStart = (totalFrames * si) / scenes.length;
      const sceneLen = totalFrames / scenes.length;
      scene.ops = scene.nodes.map((node, i) => ({
        id: `auto-${scene.id}-${node.id}`,
        type: "draw" as const,
        target: node.id,
        trigger: { word: "", wordIndex: 0, timestampSeconds: 0 },
        frame: Math.round(sceneStart + (sceneLen * (i + 0.5)) / Math.max(1, scene.nodes.length)),
      }));
    });
    issues.push({ opId: "*", reason: "no ops resolvable - drawing nodes evenly as fallback" });
  }

  // Scenes play in the order they start.
  scenes.sort((a, b) => (a.ops[0]?.frame ?? Infinity) - (b.ops[0]?.frame ?? Infinity));

  return {
    plan: { version: "2.0", fps, durationSeconds, scenes: scenes.filter((s) => s.ops.length > 0) },
    issues,
  };
}
