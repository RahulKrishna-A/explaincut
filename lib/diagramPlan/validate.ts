import { diagramPlanSchema } from "./schema";
import type { Transcript } from "@/types/transcript";
import type {
  ChartSpec,
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

const MARK_OPS = new Set(["circle", "underline", "highlight", "check", "cross", "sparkle"]);
const MAX_STICKERS_PER_SCENE = 1;
const EDGE_TARGET_OPS = new Set(["connect", "flow"]);

/** Minimum points that make each chart type worth drawing. */
const MIN_POINTS: Record<ChartSpec["type"], number> = { bar: 2, line: 3, pie: 2 };
const MAX_POINTS: Record<ChartSpec["type"], number> = { bar: 6, line: 8, pie: 5 };

/** Cleans a chart spec; returns null if it can't make a readable chart. */
function cleanChart(chart: ChartSpec | undefined, sceneId: string, issues: ValidationIssue[]): ChartSpec | null {
  if (!chart) return null;
  const seen = new Set<string>();
  let data = chart.data.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  if (chart.type !== "line") data = data.map((d) => ({ ...d, value: Math.max(0, d.value) }));
  if (chart.type === "pie") data = data.filter((d) => d.value > 0);
  if (data.length > MAX_POINTS[chart.type]) {
    issues.push({ opId: sceneId, reason: `chart had ${data.length} points - keeping the first ${MAX_POINTS[chart.type]}` });
    data = data.slice(0, MAX_POINTS[chart.type]);
  }
  if (data.length < MIN_POINTS[chart.type]) {
    issues.push({ opId: sceneId, reason: `${chart.type} chart needs at least ${MIN_POINTS[chart.type]} data points` });
    return null;
  }
  if (chart.type !== "line" && data.every((d) => d.value === 0)) {
    issues.push({ opId: sceneId, reason: "chart values are all zero" });
    return null;
  }
  return { ...chart, data };
}

function checkOp(
  op: DiagramOp,
  scene: DiagramScene,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  datumIds: Set<string>
): string | null {
  if (op.type === "draw") {
    return op.target && nodeIds.has(op.target) ? null : `node "${op.target}" not found in scene ${scene.id}`;
  }
  if (op.type === "plot") {
    return op.target && datumIds.has(op.target) ? null : `data point "${op.target}" not found in scene ${scene.id}`;
  }
  if (MARK_OPS.has(op.type)) {
    // Emphasis works on nodes and on chart data points alike.
    return op.target && (nodeIds.has(op.target) || datumIds.has(op.target))
      ? null
      : `target "${op.target}" not found in scene ${scene.id}`;
  }
  if (EDGE_TARGET_OPS.has(op.type)) {
    return op.target && edgeIds.has(op.target) ? null : `edge "${op.target}" not found in scene ${scene.id}`;
  }
  if (op.type === "title" || op.type === "note" || op.type === "sticker") {
    if (!op.text?.trim()) return `${op.type} op has no text`;
    if (op.type !== "title" && op.target && !nodeIds.has(op.target) && !datumIds.has(op.target)) {
      // A note/sticker pointing at a missing node is still worth showing - just unanchored.
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
  for (const rawScene of parsed.scenes) {
    let scene: DiagramScene = rawScene;
    if (scene.layout === "chart" || scene.chart) {
      const chart = cleanChart(scene.chart, scene.id, issues);
      if (chart) {
        // A chart scene is the chart (+ title/notes/emphasis); stray nodes would collide with it.
        scene = { ...scene, layout: "chart", chart, nodes: [], edges: [] };
      } else {
        scene = { ...scene, layout: scene.layout === "chart" ? "flow" : scene.layout, chart: undefined };
      }
    }
    const datumIds = new Set(scene.chart?.data.map((d) => d.id) ?? []);
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
    let stickers = 0;
    for (const op of scene.ops) {
      const problem = checkOp(op, scene, nodeIds, edgeIds, datumIds);
      // Stickers are seasoning: one per scene at most, or they turn into clutter.
      if (!problem && op.type === "sticker" && ++stickers > MAX_STICKERS_PER_SCENE) {
        issues.push({ opId: op.id, reason: `more than ${MAX_STICKERS_PER_SCENE} sticker in scene ${scene.id} - dropped` });
        continue;
      }
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

    if (nodes.length === 0 && !scene.chart && ops.length === 0) continue;
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
      const targets = scene.chart
        ? scene.chart.data.map((d) => ({ id: d.id, type: "plot" as const }))
        : scene.nodes.map((n) => ({ id: n.id, type: "draw" as const }));
      scene.ops = targets.map((t, i) => ({
        id: `auto-${scene.id}-${t.id}`,
        type: t.type,
        target: t.id,
        trigger: { word: "", wordIndex: 0, timestampSeconds: 0 },
        frame: Math.round(sceneStart + (sceneLen * (i + 0.5)) / Math.max(1, targets.length)),
      }));
    });
    issues.push({ opId: "*", reason: "no ops resolvable - drawing nodes evenly as fallback" });
  }

  // Scenes play in the order they start.
  scenes.sort((a, b) => (a.ops[0]?.frame ?? Infinity) - (b.ops[0]?.frame ?? Infinity));
  const playable = scenes.filter((s) => s.ops.length > 0);
  pickBoards(playable, durationSeconds, fps, issues);

  return {
    plan: { version: "2.0", fps, durationSeconds, scenes: playable },
    issues,
  };
}

/** A board needs time on screen to be worth cutting away from the speaker. */
const MIN_BOARD_SECONDS = 4.5;
/** Clips this short get one board at most; longer ones up to two. */
const TWO_BOARDS_FROM_SECONDS = 45;
/** Below this, cutting away from the speaker at all feels jumpy. */
const MIN_CLIP_FOR_BOARD_SECONDS = 15;

/** How much there is to explain in a scene - the busiest one earns the full screen. */
function complexity(scene: ResolvedDiagramScene): number {
  return scene.nodes.length + scene.edges.length * 0.75 + (scene.chart?.data.length ?? 0) * 0.8 + (scene.layout === "chart" ? 0 : 0.5);
}

/**
 * Full-screen black "board" scenes are the exception, not the rhythm: keep one
 * or two per clip, only where there's time to explain, and if the planner chose
 * none, give the most complex explanation the full screen anyway.
 */
function pickBoards(scenes: ResolvedDiagramScene[], durationSeconds: number, fps: number, issues: ValidationIssue[]): void {
  const span = (i: number) => {
    const start = scenes[i].ops[0]?.frame ?? 0;
    const end = i + 1 < scenes.length ? (scenes[i + 1].ops[0]?.frame ?? start) : Math.round(durationSeconds * fps);
    return (end - start) / fps;
  };
  const isLast = (i: number) => i === scenes.length - 1;

  if (durationSeconds < MIN_CLIP_FOR_BOARD_SECONDS || scenes.length < 2) {
    for (const s of scenes) if (s.canvas === "board") s.canvas = undefined;
    return;
  }

  // Too short to read on a full screen - stays with the speaker.
  scenes.forEach((s, i) => {
    if (s.canvas === "board" && span(i) < MIN_BOARD_SECONDS) {
      issues.push({ opId: s.id, reason: `board scene only ${span(i).toFixed(1)}s long - kept on the speaker` });
      s.canvas = undefined;
    }
  });

  const max = durationSeconds >= TWO_BOARDS_FROM_SECONDS ? 2 : 1;
  const boards = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.canvas === "board");
  if (boards.length > max) {
    const keep = new Set(
      [...boards]
        .sort((a, b) => complexity(b.s) - complexity(a.s))
        .slice(0, max)
        .map(({ s }) => s.id)
    );
    for (const { s } of boards) {
      if (keep.has(s.id)) continue;
      issues.push({ opId: s.id, reason: `more than ${max} board scene(s) - kept on the speaker` });
      s.canvas = undefined;
    }
  }

  if (boards.length === 0) {
    // Prefer not to end the clip on black: the last scene is the fallback only.
    const candidates = scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => span(i) >= MIN_BOARD_SECONDS + 1 && (s.nodes.length >= 4 || (s.chart?.data.length ?? 0) >= 4))
      .sort((a, b) => Number(isLast(a.i)) - Number(isLast(b.i)) || complexity(b.s) - complexity(a.s));
    if (candidates[0]) {
      candidates[0].s.canvas = "board";
      issues.push({ opId: candidates[0].s.id, reason: "no board scene planned - giving the most complex explanation the full screen" });
    }
  }
}
