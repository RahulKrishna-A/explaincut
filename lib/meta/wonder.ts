import { metaPostJSON } from "./client";
import type { Transcript } from "@/types/transcript";
import type { RenderPlan } from "@/types/diagramPlan";

const MODEL_ID = "muse-wonder-1.0";

export interface WonderIssue {
  description: string;
  severity: "low" | "medium" | "high";
}

interface ResponsesApiResult {
  output_text?: string;
  output?: { content?: { text?: string }[] }[];
}

function extractText(res: ResponsesApiResult): string | undefined {
  return res.output_text ?? res.output?.[0]?.content?.[0]?.text;
}

function extractJsonArray(text: string): WonderIssue[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  const parsed = JSON.parse(jsonText.trim());
  return Array.isArray(parsed) ? parsed : (parsed.issues ?? []);
}

/**
 * Stretch review pass: asks Muse Wonder to critique sampled output frames
 * against the transcript/plan. Report-only, no auto-fix. Always returns an
 * array (never throws) - a parse failure here must never block the core
 * render/download flow.
 */
export async function reviewRender(
  transcript: Transcript,
  plan: RenderPlan,
  frameJpegBase64: string[]
): Promise<WonderIssue[]> {
  try {
    const content: unknown[] = [
      {
        type: "input_text",
        text: `You are reviewing a generated explainer video. The transcript is: "${transcript.text}". The hand-drawn overlay has ${plan.scenes.length} scene(s) with ${plan.scenes.reduce((n, sc) => n + sc.elements.length, 0)} drawn elements, placed in the free space around the speaker. Look at the attached sampled frames and report, as a JSON array of {description, severity}, any issues where a diagram element overlaps the speaker's face, appears mistimed relative to what's being said, or is unreadable. Return [] if there are no issues. Output ONLY the JSON array.`,
      },
      ...frameJpegBase64.map((b64) => ({ type: "input_image", image_base64: b64 })),
    ];

    const res = (await metaPostJSON("/responses", {
      model: MODEL_ID,
      reasoning: { effort: "medium" },
      input: [{ role: "user", content }],
    })) as ResponsesApiResult;

    const text = extractText(res);
    if (!text) return [];
    return extractJsonArray(text);
  } catch (err) {
    console.error("Muse Wonder review failed (non-fatal):", err);
    return [];
  }
}
