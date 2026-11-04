import { metaPostJSON } from "./client";
import type { Transcript } from "@/types/transcript";
import type { FreeSpace } from "@/types/diagramPlan";
import { ICON_NAMES } from "@/types/diagramPlan";
import { describeFreeSpace } from "@/lib/layout/freeSpace";
import ragExample from "@/lib/diagramPlan/sample-plans/rag-example.json";
import chartExample from "@/lib/diagramPlan/sample-plans/chart-example.json";

const MODEL_ID = "muse-spark-1.3";

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : content;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  return JSON.parse(jsonText.slice(start, end + 1));
}

/** Rough per-scene node budget, so scenes never cram more than the free space can hold legibly. */
function nodeBudget(space: FreeSpace): number {
  const main = space.regions[0];
  if (!main) return 3;
  const share = (main.w * main.h) / (space.width * space.height);
  if (share > 0.3) return 5;
  if (share > 0.16) return 4;
  return 3;
}

function buildPrompt(transcript: Transcript, space: FreeSpace): string {
  const budget = nodeBudget(space);
  return `You are the art director of a hand-drawn explainer video. A person talks to camera; while they speak, a pen sketches a visual in the empty space around them - boxes being drawn, arrows connecting them, charts plotted bar by bar, things circled and underlined - each stroke landing exactly on the word that motivates it. Your job: decide WHAT gets drawn and ON WHICH WORD, and pick the visual FORM that best shows the structure of each idea.

${describeFreeSpace(space)}
Layout is computed for you from that free space - never give coordinates. Keep at most ${budget} nodes (or chart data points: bar <= 6, line <= 8, pie <= 5) per scene so it stays readable; use more scenes instead.

Output ONLY one JSON object (no prose, no markdown fences):
{
  "version": "2.0",
  "fps": 30,
  "durationSeconds": ${transcript.durationSeconds},
  "scenes": [{
    "id": string,
    "layout": "flow" | "hub" | "stack" | "cycle" | "compare" | "tree" | "timeline" | "chart",
    "chart"?: { "type": "bar" | "line" | "pie", "data": [{ "id": string, "label": string, "value": number }], "unit"?: string, "yLabel"?: string, "showValues"?: boolean },
    "nodes": [{ "id": string, "label": string, "shape"?: Shape, "icon"?: Icon, "color"?: Color, "group"?: "a"|"b" }],
    "edges": [{ "id": string, "from": nodeId, "to": nodeId, "label"?: string, "dashed"?: boolean, "bidirectional"?: boolean }],
    "ops": [{ "id": string, "type": OpType, "target"?: string, "text"?: string, "trigger": { "word": string, "wordIndex": number } }]
  }]
}

Shape: "box" | "pill" | "circle" | "cylinder" (storage/memory/database) | "cloud" (outputs, ideas, the internet) | "diamond" (decisions) | "doc" (files, documents)
Icon: ${ICON_NAMES.map((i) => `"${i}"`).join(" | ")}
Color: "blue" | "pink" | "green" | "orange" | "purple"
Choose the FORM that matches the idea's structure (this matters more than anything else):
- flow = steps/process in order; hub = one central concept with satellites; stack = layers of a system; cycle = a loop that returns to the start; compare = two sides (set node.group "a"/"b").
- tree = a hierarchy / taxonomy / breakdown ("X has two kinds", "split into", "consists of"): edges go parent -> child, one parent per node.
- timeline = events or phases in time order ("first... then... finally", years, versions, history). Nodes are placed along a drawn time arrow in node order; edges are ignored.
- chart = QUANTITIES. Use it whenever the speaker gives numbers, percentages, amounts, rankings, growth, a trend, or "X is much bigger/faster/cheaper than Y". Set "chart" and leave nodes/edges empty:
  - bar: compare amounts across categories (2-6 bars).
  - line: change over time / a trend (3-8 points, in time order; label = the time, e.g. "2021", "Week 1").
  - pie: parts of a whole / shares / percentages that add up (2-5 slices).
  - "value" is a plain number (no units in it); put the unit in "unit" ("%", "ms", "$", "x", "users").
  - Use the speaker's real numbers. If they describe a trend or comparison WITHOUT numbers, you may still chart it with illustrative values but set "showValues": false.
Prefer a chart or tree over plain boxes whenever the idea really is quantitative or hierarchical - and mix forms across scenes so the video stays visually varied.

OpType (what the pen does on the trigger word):
- "title": write a short heading for the scene (text, <= 5 words). Usually the first op of the first scene.
- "draw": draw a node (target = node id). Trigger on the word that names the thing.
- "connect": draw an arrow (target = edge id). Trigger on the verb/relationship ("sends", "checks", "then").
- "flow": a glowing packet travels along an existing arrow (target = edge id) - use when the speaker describes data/requests moving.
- "circle" | "underline" | "highlight" | "sparkle" | "check" | "cross": emphasis on a node (target = node id) - on emphatic words ("key", "most important", "optimal", "wrong", "not").
- "note": a short handwritten aside next to a node or data point (target optional, text <= 4 words) - for asides, conditions, numbers.
- "sticker": slap a small, colourful sticker illustration on screen (generated as an image) - the eye-candy that makes a reel feel produced. "text" = what it depicts, as a short concrete visual description (e.g. "a database cylinder", "a glowing brain", "a rocket launching", "a stack of gold coins", "a padlock", "a smartphone"); "target" = the node or data point it belongs beside (optional). Use one in each scene that has a concrete, picturable anchor - a real thing the speaker names (database, server, phone, money, coffee) or a clear visual metaphor for the key idea (memory -> a brain, speed -> a rocket, security -> a padlock, search -> a magnifying glass). Pick the most important thing in the scene, trigger it on the word that names it, and depict it rather than repeating a label word for word. Skip it for scenes that are purely abstract and for chart scenes; never more than one per scene.
- "plot": chart scenes only - plot one data point (target = datum id): a bar grows, the line extends, a slice sweeps. Trigger on the word naming that category or saying its number. Emphasis ops and notes may target datum ids too.

Rules:
- Make it RICH and alive: every scene should mix draws, arrows, at least one flow or emphasis, and icons on most nodes. Aim for an op every ~1.5-2.5 seconds of speech; never leave more than ~4 seconds with nothing new being drawn.
- Node labels: 1-3 words, Title-ish case, no trailing punctuation.
- Start a new scene when the speaker moves to a new idea (the previous drawing is wiped). Each scene's ops must come after the previous scene's ops.
- Order ops by wordIndex. A node should be drawn before (or by) the op that references it.
- Every trigger.word MUST be copied verbatim from the transcript word array below, and wordIndex MUST be that word's exact index.
- Every target MUST reference an id inside the same scene (a node, edge, or chart datum id).

Examples (format reference only - do not reuse their content or indices):
${JSON.stringify(ragExample)}
${JSON.stringify(chartExample)}

Transcript word array (index:word):
${transcript.words.map((w, i) => `${i}:${w.word}`).join(" ")}

Full transcript: "${transcript.text}"`;
}

/** Calls Muse Spark via Chat Completions and returns the raw (unvalidated) v2 diagram plan JSON. */
export async function generateDiagramPlan(transcript: Transcript, space: FreeSpace): Promise<unknown> {
  const response = (await metaPostJSON("/chat/completions", {
    model: MODEL_ID,
    messages: [{ role: "user", content: buildPrompt(transcript, space) }],
    temperature: 0.4,
  })) as ChatCompletionResponse;

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Muse Spark returned no content: ${JSON.stringify(response).slice(0, 500)}`);
  }
  return extractJson(content);
}

export interface FindingForReplan {
  id: string;
  kind: string;
  sceneId?: string;
  target?: string;
  time: number;
  title: string;
  detail: string;
  suggestion?: string;
}

/**
 * The fix step of the self-review loop: Muse Spark gets its own earlier plan
 * plus the reviewer's findings and returns a revised plan. Only the flagged
 * scenes are meant to change - the caller enforces that by merging.
 */
export async function replanScenes(
  transcript: Transcript,
  space: FreeSpace,
  currentPlan: unknown,
  findings: FindingForReplan[]
): Promise<unknown> {
  const scenes = [...new Set(findings.map((f) => f.sceneId).filter(Boolean))];
  const prompt = `${buildPrompt(transcript, space)}

---
REVISION TASK. You already produced the plan below. A reviewer (Muse Wonder, plus exact measurements of the rendered video) watched the result and flagged problems. Revise the plan to fix them.

CURRENT PLAN:
${JSON.stringify(currentPlan)}

FINDINGS TO FIX:
${findings
  .map(
    (f) =>
      `- [${f.id}] ${f.kind} in scene ${f.sceneId ?? "?"} at ${f.time.toFixed(1)}s${f.target ? ` (${f.target})` : ""}: ${f.title}. ${f.detail}${f.suggestion ? ` Suggested: ${f.suggestion}` : ""}`
  )
  .join("\n")}

Timing budget (the renderer uses ONE pen): a node takes ~1.0-1.5 s to draw, an arrow ~0.6 s, a note ~1 s, a bar/point ~0.8 s. Leave at least ~1.2 s between ops that draw new things, and finish a scene's last drawing op at least ~1.5 s before the next scene's first op - otherwise things land late or are wiped as soon as they appear.

How to fix each kind:
- timing (late / never drawn / wiped too soon): trigger the op on an EARLIER word that still introduces the idea, remove a less important op nearby (notes, sparkles, extra flows), or move part of the scene into a new scene. Keep the same word-index rules.
- overlap (hidden behind the speaker): fewer nodes, shorter labels, or a layout that needs less room (e.g. stack or timeline instead of hub).
- relevance (doesn't match the speech): change labels, icons, chart data or the layout so the visual says what the speaker says.

Rules: revise ONLY scene(s) ${scenes.length ? scenes.join(", ") : "involved in the findings"}; every other scene is kept as it is automatically. Keep the scene ids of the scenes you revise (a scene you split out needs a new id). Word indices still refer to the full transcript.
Output ONLY one JSON object of the form {"scenes": [ ...the revised scene(s), plus any new split-out scenes... ]} - do NOT repeat unchanged scenes.`;

  // The revised plan is long; if it comes back as broken JSON, show Spark its own error and ask once more.
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: prompt }];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = (await metaPostJSON("/chat/completions", {
      model: MODEL_ID,
      messages,
      temperature: attempt === 0 ? 0.3 : 0.1,
    })) as ChatCompletionResponse;
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error("Muse Spark returned no revision");
      continue;
    }
    try {
      return extractJson(content);
    } catch (err) {
      lastError = err;
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `That isn't valid JSON (${err instanceof Error ? err.message : String(err)}). Output ONLY the corrected {"scenes": [...]} object as valid JSON - no prose, no comments, no trailing commas.`,
        }
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Muse Spark revision failed");
}
