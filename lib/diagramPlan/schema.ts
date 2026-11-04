import { z } from "zod";
import { TONES } from "@/lib/style/tone";
import { ACCENTS, CHART_TYPES, ICON_NAMES, NODE_SHAPES, OP_TYPES, SCENE_CANVASES, SCENE_LAYOUTS } from "@/types/diagramPlan";

// The model occasionally invents a shape/icon/colour name. Rather than failing
// the whole plan, unknown cosmetic values are silently dropped (.catch).
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shape: optionalEnum(NODE_SHAPES),
  icon: optionalEnum(ICON_NAMES),
  color: optionalEnum(ACCENTS),
  group: z.enum(["a", "b"]).optional().catch(undefined),
});

export const diagramEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  dashed: z.boolean().optional(),
  bidirectional: z.boolean().optional(),
});

export const diagramOpSchema = z.object({
  id: z.string().min(1),
  type: z.enum(OP_TYPES),
  target: z.string().optional(),
  text: z.string().optional(),
  trigger: z.object({
    word: z.string(),
    wordIndex: z.number().int().nonnegative(),
    timestampSeconds: z.number().optional(),
  }),
});

// Models write numbers as "40%", "1,200" or "3.5x" surprisingly often - pull the number out.
const looseNumber = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }
  return NaN;
}, z.number().finite());

export const chartDatumSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: looseNumber,
  color: optionalEnum(ACCENTS),
});

export const chartSpecSchema = z.object({
  type: z.enum(CHART_TYPES).catch("bar"),
  // Drop individual unparseable points instead of failing the chart.
  data: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = chartDatumSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    ),
  unit: z.string().max(8).optional().catch(undefined),
  yLabel: z.string().max(24).optional().catch(undefined),
  showValues: z.boolean().optional().catch(undefined),
});

export const diagramSceneSchema = z.object({
  id: z.string().min(1),
  layout: z.enum(SCENE_LAYOUTS).catch("flow"),
  nodes: z.array(diagramNodeSchema).default([]),
  edges: z.array(diagramEdgeSchema).default([]),
  ops: z.array(diagramOpSchema).default([]),
  chart: chartSpecSchema.optional().catch(undefined),
  tone: z.enum(TONES).optional().catch(undefined),
  canvas: z.enum(SCENE_CANVASES).optional().catch(undefined),
});

export const diagramPlanSchema = z.object({
  version: z.literal("2.0"),
  fps: z.number().positive().default(30),
  durationSeconds: z.number().positive(),
  scenes: z.array(diagramSceneSchema).min(1),
});

export type RawDiagramPlanInput = z.infer<typeof diagramPlanSchema>;
