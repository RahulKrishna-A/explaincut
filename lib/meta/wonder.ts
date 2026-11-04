import { metaPostJSON } from "./client";
import type { Transcript } from "@/types/transcript";
import type { RenderPlan } from "@/types/diagramPlan";
import type { CheckKind, ReviewFinding } from "@/types/review";
import { elementLabel } from "@/lib/review/measure";

const MODEL_ID = "muse-wonder-1.0";

export interface ReviewFrame {
  time: number;
  jpegBase64: string;
}

export type WonderFinding = Pick<ReviewFinding, "kind" | "severity" | "sceneId" | "target" | "time" | "title" | "detail" | "suggestion">;

interface ResponsesApiResult {
  output_text?: string;
  output?: { content?: { text?: string }[] }[];
}

function extractText(res: ResponsesApiResult): string {
  const text = res.output_text ?? res.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  if (!text) throw new Error("Muse Wonder returned no text");
  return text;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(body.slice(start));
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** What's drawn when, and on which word - so Wonder judges the frames against intent, not just pixels. */
export function describePlanForReview(plan: RenderPlan, transcript: Transcript): string {
  const wordAt = (t: number) => {
    const w = transcript.words.find((x) => x.startSeconds <= t + 0.05 && x.endSeconds >= t - 0.05);
    return w ? `"${w.word}"` : "";
  };
  return plan.scenes
    .map((scene) => {
      const items = scene.elements
        .filter((el) => ["node", "text", "bar", "point", "slice", "axes", "sticker"].includes(el.kind))
        .map((el) => {
          const label = el.kind === "axes" ? "chart axes" : `${el.kind} "${elementLabel(el)}"`;
          const said = el.cue !== undefined ? `, cued by ${wordAt(el.cue / plan.fps)} at ${fmt(el.cue / plan.fps)}` : "";
          return `  - ${label}: drawn ${fmt(el.start / plan.fps)}-${fmt((el.start + el.duration) / plan.fps)}${said}`;
        });
      return `Scene ${scene.id} (on screen ${fmt(scene.start / plan.fps)}-${fmt(scene.end / plan.fps)}):\n${items.join("\n")}`;
    })
    .join("\n");
}

async function callWonder(text: string, frames: ReviewFrame[]): Promise<unknown> {
  const content: unknown[] = [{ type: "input_text", text }];
  frames.forEach((f, i) => {
    content.push({ type: "input_text", text: `Frame ${i + 1} at ${fmt(f.time)}:` });
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${f.jpegBase64}` });
  });
  const res = (await metaPostJSON("/responses", {
    model: MODEL_ID,
    reasoning: { effort: "medium" },
    input: [{ role: "user", content }],
  })) as ResponsesApiResult;
  return extractJson(extractText(res));
}

const KINDS: CheckKind[] = ["relevance", "timing", "overlap"];

/**
 * Muse Wonder watches sampled frames of the finished cut and critiques it
 * against what was said. Throws on API/parse failure - the caller decides
 * how to degrade (measured checks still run without it).
 */
export async function reviewWithWonder(transcript: Transcript, plan: RenderPlan, frames: ReviewFrame[]): Promise<WonderFinding[]> {
  const prompt = `You are the reviewer for an auto-generated explainer video. A person talks to camera; a hand-drawn diagram is sketched in the space around them, each element meant to appear on the word that motivates it. Judge the attached frames like a demanding video editor.

Transcript (with seconds): ${transcript.words.map((w) => `${w.word}@${w.startSeconds.toFixed(1)}`).join(" ")}

What the plan draws, and when:
${describePlanForReview(plan, transcript)}

Report real problems a viewer would notice, in three kinds:
- "relevance": a drawing, label or chart doesn't match what's being said, is misleading, or is unreadable.
- "timing": something appears clearly before or after the speaker talks about it.
- "overlap": a drawing covers the speaker's face, or is cut off / hidden behind them.

Output ONLY a JSON array (no prose). Each item:
{"kind": "relevance"|"timing"|"overlap", "severity": "low"|"medium"|"high", "sceneId": string, "target": short label of the affected element, "time": seconds where it shows, "title": one line (<= 12 words), "detail": one or two sentences, "suggestion": how to fix it in the plan}
Use "high" only for things that would embarrass the creator if posted. Return [] if the cut is good.`;
  const parsed = await callWonder(prompt, frames);
  const items = Array.isArray(parsed) ? parsed : ((parsed as { issues?: unknown[] }).issues ?? []);
  return items.flatMap((raw): WonderFinding[] => {
    const it = raw as Record<string, unknown>;
    const kind = KINDS.includes(it.kind as CheckKind) ? (it.kind as CheckKind) : "relevance";
    const severity = ["low", "medium", "high"].includes(it.severity as string) ? (it.severity as WonderFinding["severity"]) : "medium";
    const title = typeof it.title === "string" ? it.title : typeof it.description === "string" ? it.description : "";
    if (!title) return [];
    return [
      {
        kind,
        severity,
        sceneId: typeof it.sceneId === "string" ? it.sceneId : undefined,
        target: typeof it.target === "string" ? it.target : undefined,
        time: Number.isFinite(Number(it.time)) ? Number(it.time) : 0,
        title,
        detail: typeof it.detail === "string" ? it.detail : "",
        suggestion: typeof it.suggestion === "string" ? it.suggestion : undefined,
      },
    ];
  });
}

export interface WonderVerdict {
  id: string;
  fixed: boolean;
  note?: string;
}

/** Second look after the fix: for each earlier finding, is it gone in the new frames? */
export async function verifyWithWonder(
  transcript: Transcript,
  plan: RenderPlan,
  findings: Pick<ReviewFinding, "id" | "kind" | "title" | "detail" | "time">[],
  frames: ReviewFrame[]
): Promise<WonderVerdict[]> {
  const prompt = `You reviewed an explainer video earlier and flagged problems. The video has been re-planned and re-rendered. Look at the new frames and decide, for each earlier finding, whether it is fixed.

Transcript: "${transcript.text}"

What the new plan draws, and when:
${describePlanForReview(plan, transcript)}

Earlier findings:
${findings.map((f) => `- id ${f.id} [${f.kind}] at ${fmt(f.time)}: ${f.title} - ${f.detail}`).join("\n")}

Output ONLY a JSON array: [{"id": string, "fixed": boolean, "note": "what you see now, <= 15 words"}] with one entry per finding id.`;
  const parsed = await callWonder(prompt, frames);
  const items = Array.isArray(parsed) ? parsed : [];
  return items.flatMap((raw): WonderVerdict[] => {
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== "string" || typeof it.fixed !== "boolean") return [];
    return [{ id: it.id, fixed: it.fixed, note: typeof it.note === "string" ? it.note : undefined }];
  });
}
