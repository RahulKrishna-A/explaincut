import { z } from "zod";
import { CAPTION_FONTS, CAPTION_SIZES, DEFAULT_RENDER_OPTIONS, type RenderOptions } from "@/types/renderOptions";

const d = DEFAULT_RENDER_OPTIONS.captions;
const r = DEFAULT_RENDER_OPTIONS.selfReview;

const renderOptionsSchema = z.object({
  captions: z
    .object({
      enabled: z.boolean().catch(d.enabled).default(d.enabled),
      font: z.enum(CAPTION_FONTS).catch(d.font).default(d.font),
      size: z.enum(CAPTION_SIZES).catch(d.size).default(d.size),
      highlightActiveWord: z.boolean().catch(d.highlightActiveWord).default(d.highlightActiveWord),
    })
    .catch({ ...d })
    .default({ ...d }),
  selfReview: z
    .object({ enabled: z.boolean().catch(r.enabled).default(r.enabled) })
    .catch({ ...r })
    .default({ ...r }),
});

/** Lenient: anything missing or malformed falls back to the default, so a stale client can't break a job. */
export function parseRenderOptions(input: unknown): RenderOptions {
  return renderOptionsSchema.parse(input ?? {});
}
