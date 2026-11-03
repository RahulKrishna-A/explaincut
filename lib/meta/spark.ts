import { metaPostJSON } from "./client";
import type { Transcript } from "@/types/transcript";
import type { FreeSpace } from "@/types/diagramPlan";
import { ICON_NAMES } from "@/types/diagramPlan";
import { describeFreeSpace } from "@/lib/layout/freeSpace";
import ragExample from "@/lib/diagramPlan/sample-plans/rag-example.json";

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
  return `You are the art director of a hand-drawn explainer video. A person talks to camera; while they speak, a pen sketches a diagram in the empty space around them - boxes being drawn, arrows connecting them, things circled and underlined - each stroke landing exactly on the word that motivates it. Your job: decide WHAT gets drawn and ON WHICH WORD.

${describeFreeSpace(space)}
Layout is computed for you from that free space - never give coordinates. Keep at most ${budget} nodes per scene so it stays readable; use more scenes instead.

Output ONLY one JSON object (no prose, no markdown fences):
{
  "version": "2.0",
  "fps": 30,
  "durationSeconds": ${transcript.durationSeconds},
  "scenes": [{
    "id": string,
    "layout": "flow" | "hub" | "stack" | "cycle" | "compare",
    "nodes": [{ "id": string, "label": string, "shape"?: Shape, "icon"?: Icon, "color"?: Color, "group"?: "a"|"b" }],
    "edges": [{ "id": string, "from": nodeId, "to": nodeId, "label"?: string, "dashed"?: boolean, "bidirectional"?: boolean }],
    "ops": [{ "id": string, "type": OpType, "target"?: string, "text"?: string, "trigger": { "word": string, "wordIndex": number } }]
  }]
}

Shape: "box" | "pill" | "circle" | "cylinder" (storage/memory/database) | "cloud" (outputs, ideas, the internet) | "diamond" (decisions) | "doc" (files, documents)
Icon: ${ICON_NAMES.map((i) => `"${i}"`).join(" | ")}
Color: "blue" | "pink" | "green" | "orange" | "purple"
Layouts: flow = steps in order; hub = one central concept with satellites; stack = layers of a system; cycle = a loop that returns to the start; compare = two sides (set node.group "a"/"b").

OpType (what the pen does on the trigger word):
- "title": write a short heading for the scene (text, <= 5 words). Usually the first op of the first scene.
- "draw": draw a node (target = node id). Trigger on the word that names the thing.
- "connect": draw an arrow (target = edge id). Trigger on the verb/relationship ("sends", "checks", "then").
- "flow": a glowing packet travels along an existing arrow (target = edge id) - use when the speaker describes data/requests moving.
- "circle" | "underline" | "highlight" | "sparkle" | "check" | "cross": emphasis on a node (target = node id) - on emphatic words ("key", "most important", "optimal", "wrong", "not").
- "note": a short handwritten aside next to a node (target optional, text <= 4 words) - for asides, conditions, numbers.

Rules:
- Make it RICH and alive: every scene should mix draws, arrows, at least one flow or emphasis, and icons on most nodes. Aim for an op every ~1.5-2.5 seconds of speech; never leave more than ~4 seconds with nothing new being drawn.
- Node labels: 1-3 words, Title-ish case, no trailing punctuation.
- Start a new scene when the speaker moves to a new idea (the previous drawing is wiped). Each scene's ops must come after the previous scene's ops.
- Order ops by wordIndex. A node should be drawn before (or by) the op that references it.
- Every trigger.word MUST be copied verbatim from the transcript word array below, and wordIndex MUST be that word's exact index.
- Every target MUST reference an id inside the same scene.

Example (format reference only - do not reuse its content or indices):
${JSON.stringify(ragExample)}

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
