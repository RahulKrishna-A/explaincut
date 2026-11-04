/**
 * Diagram plan v2.
 *
 * Three layers of data:
 *  1. DiagramPlan         - raw, semantic output from Muse Spark (what to draw, and on which word).
 *  2. ResolvedDiagramPlan - validated; every op's trigger resolved to a real transcript frame.
 *  3. RenderPlan          - fully laid out in pixels inside the speaker's free space, with every
 *                           element's start frame/duration decided. This is all Remotion consumes.
 */

import type { StickerEntrance, StickerMaterial, Tone } from "@/lib/style/tone";

export const NODE_SHAPES = ["box", "pill", "circle", "cylinder", "cloud", "diamond", "doc"] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];

export const ICON_NAMES = [
  "user",
  "bot",
  "database",
  "search",
  "chat",
  "doc",
  "gear",
  "bulb",
  "bolt",
  "cloud",
  "lock",
  "clock",
  "globe",
  "code",
  "chart",
  "star",
  "server",
  "mail",
  "chip",
  "heart",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const ACCENTS = ["blue", "pink", "green", "orange", "purple", "yellow"] as const;
export type Accent = (typeof ACCENTS)[number];

export const SCENE_LAYOUTS = ["flow", "hub", "stack", "cycle", "compare", "tree", "timeline", "chart"] as const;
export type SceneLayout = (typeof SCENE_LAYOUTS)[number];

export const OP_TYPES = [
  "title", // write the scene heading (text)
  "draw", // draw a node (target = node id)
  "connect", // draw an arrow (target = edge id)
  "flow", // animate a glowing packet travelling along an arrow (target = edge id)
  "circle", // scribble a circle around a node
  "underline", // underline a node
  "highlight", // marker-highlight a node
  "check", // tick next to a node
  "cross", // cross a node out
  "sparkle", // emphasis strokes around a node
  "note", // handwritten annotation (text) next to a node (target optional)
  "plot", // chart scenes: plot one data point (target = datum id) - a bar grows, a line extends, a slice sweeps
  "sticker", // slap a small generated sticker illustration (text = what it shows) next to a node (target optional)
] as const;
export type DiagramOpType = (typeof OP_TYPES)[number];

export interface DiagramNode {
  id: string;
  label: string;
  shape?: NodeShape;
  icon?: IconName;
  color?: Accent;
  /** Only for layout "compare": which side the node belongs to. */
  group?: "a" | "b";
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  bidirectional?: boolean;
}

export interface DiagramOpTrigger {
  word: string;
  wordIndex: number;
  timestampSeconds?: number;
}

export interface DiagramOp {
  id: string;
  type: DiagramOpType;
  target?: string;
  text?: string;
  trigger: DiagramOpTrigger;
}

export const CHART_TYPES = ["bar", "line", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartDatum {
  id: string;
  label: string;
  value: number;
  color?: Accent;
}

/** Data for layout "chart". Datums behave like nodes: ops "plot"/"circle"/"note"... target their ids. */
export interface ChartSpec {
  type: ChartType;
  data: ChartDatum[];
  /** Appended to written values, e.g. "%", "ms", "x", "k". */
  unit?: string;
  /** Short axis caption for bar/line, e.g. "Latency". */
  yLabel?: string;
  /** False when values are illustrative (speaker gave no real numbers) - only the shape is drawn. */
  showValues?: boolean;
}

export interface DiagramScene {
  id: string;
  layout: SceneLayout;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  ops: DiagramOp[];
  /** Required when layout === "chart". */
  chart?: ChartSpec;
  /** The speaker's tone in this scene - picks sticker style, material, entrance and motion energy. */
  tone?: Tone;
  /**
   * Where the scene is drawn. "speaker" (default) = in the free space around the person.
   * "board" = the speaker fades out to a full-screen black canvas and the drawing takes the
   * whole frame - for the one or two most complex explanations in a clip.
   */
  canvas?: SceneCanvas;
}

export const SCENE_CANVASES = ["speaker", "board"] as const;
export type SceneCanvas = (typeof SCENE_CANVASES)[number];

/** Raw output from Muse Spark - not yet validated or resolved to frames. */
export interface DiagramPlan {
  version: "2.0";
  fps: number;
  durationSeconds: number;
  scenes: DiagramScene[];
}

export interface ResolvedDiagramOp extends DiagramOp {
  frame: number;
}

export interface ResolvedDiagramScene extends Omit<DiagramScene, "ops"> {
  ops: ResolvedDiagramOp[];
}

export interface ResolvedDiagramPlan extends Omit<DiagramPlan, "scenes"> {
  scenes: ResolvedDiagramScene[];
}

// ---------------------------------------------------------------------------
// Free space (where the speaker is NOT)
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RegionSide = "top" | "bottom" | "left" | "right" | "center";

export interface FreeRegion extends Rect {
  side: RegionSide;
}

export type SketchTheme = "ink" | "chalk";

export interface FreeSpace {
  width: number;
  height: number;
  /** Largest first. Pixel coordinates in the video frame. */
  regions: FreeRegion[];
  /** Union bounding box of the speaker across the clip, if known. */
  person?: Rect;
  /** "ink" = dark marker on a light background, "chalk" = light strokes on a dark one. */
  theme: SketchTheme;
  /** Drawable area of a full-screen "board" scene (the whole frame minus margins and the caption band). */
  board?: Rect;
}

// ---------------------------------------------------------------------------
// Render plan (pixels + frames)
// ---------------------------------------------------------------------------

interface ElementBase {
  id: string;
  /** First frame the pen touches this element. */
  start: number;
  /** Frames the pen spends drawing it. */
  duration: number;
  seed: number;
  color: Accent;
  /** Frame of the word that asked for this element (absent for auto-filled elements). Used by the timing check. */
  cue?: number;
}

export interface NodeElement extends ElementBase {
  kind: "node";
  box: Rect;
  shape: NodeShape;
  icon?: IconName;
  lines: string[];
  fontSize: number;
}

export interface EdgeElement extends ElementBase {
  kind: "edge";
  from: Rect;
  to: Rect;
  fromShape: NodeShape;
  toShape: NodeShape;
  label?: string;
  fontSize: number;
  dashed: boolean;
  bidirectional: boolean;
  /** Signed bend as a fraction of the edge length. */
  bend: number;
}

export interface PacketElement extends ElementBase {
  kind: "packet";
  edgeId: string;
  trips: number;
}

export type MarkType = "circle" | "underline" | "highlight" | "check" | "cross" | "sparkle" | "divider" | "spine";

export interface MarkElement extends ElementBase {
  kind: "mark";
  mark: MarkType;
  target: Rect;
  targetShape: NodeShape;
  /** "spine" only: marker dots along the line (timeline events). */
  ticks?: { x: number; y: number }[];
}

// --- Charts ----------------------------------------------------------------

export interface AxesElement extends ElementBase {
  kind: "axes";
  /** Plot area; the x axis runs along its bottom edge, the y axis up its left edge. */
  plot: Rect;
  /** Light guide lines across the plot (fractions of its height, 0 = baseline). */
  grid: number[];
  yLabel?: string;
  fontSize: number;
  /** Faint paper card behind the whole chart so it reads over any background. */
  card: Rect;
}

export interface BarElement extends ElementBase {
  kind: "bar";
  /** Final bar rectangle (it grows from the baseline into this). */
  bar: Rect;
  orientation: "vertical" | "horizontal";
  label: string;
  /** Top-left of the category label block. */
  labelAt: { x: number; y: number; w: number; align: "left" | "center" | "right" };
  value?: string;
  valueAt?: { x: number; y: number; w: number; align: "left" | "center" };
  fontSize: number;
}

export interface PointElement extends ElementBase {
  kind: "point";
  at: { x: number; y: number };
  /** Previous point - the line segment is traced from there to here. */
  prev?: { x: number; y: number };
  /** Baseline y, for the soft area fill under the segment. */
  baseline: number;
  label: string;
  labelAt: { x: number; y: number; w: number };
  value?: string;
  valueAt?: { x: number; y: number; w: number };
  fontSize: number;
}

export interface SliceElement extends ElementBase {
  kind: "slice";
  cx: number;
  cy: number;
  r: number;
  /** Donut hole radius (0 = full pie). */
  inner: number;
  /** Radians, clockwise from 12 o'clock. */
  a0: number;
  a1: number;
  lines: string[];
  labelAt: { x: number; y: number; w: number; align: "left" | "center" | "right" };
  /** Where the short leader line from the slice to its label starts and ends. */
  leader?: { from: { x: number; y: number }; to: { x: number; y: number } };
  fontSize: number;
}

export interface TextElement extends ElementBase {
  kind: "text";
  variant: "title" | "note";
  lines: string[];
  fontSize: number;
  /** Top-left of the text block. */
  x: number;
  y: number;
  align: "left" | "center";
  blockWidth: number;
  /** Optional hand-drawn pointer from the note to what it describes. */
  pointTo?: Rect;
}

/** A small illustration generated by Muse Image, slapped on like a sticker. */
export interface StickerElement extends ElementBase {
  kind: "sticker";
  box: Rect;
  /** PNG data URL with a transparent background. */
  src: string;
  /** Resting tilt, degrees. */
  tilt: number;
  /** What it shows (for the review / logs). */
  subject: string;
  /** How light plays across it (from the scene's tone). */
  material: StickerMaterial;
  /** How it arrives (from the scene's tone). */
  entrance: StickerEntrance;
  /** Frame it starts lifting off, as the scene clears. */
  exitAt: number;
}

/** Generated sticker images, keyed by stickerKey(subject). */
export type StickerAssets = Record<string, { src: string; width: number; height: number }>;

export type RenderElement =
  | NodeElement
  | EdgeElement
  | PacketElement
  | MarkElement
  | TextElement
  | AxesElement
  | BarElement
  | PointElement
  | SliceElement
  | StickerElement;

export interface RenderScene {
  id: string;
  /** The speaker's tone - sets motion energy for the scene's elements. */
  tone?: Tone;
  start: number;
  /** Frame the scene is fully erased by (Infinity-like for the last scene: durationInFrames). */
  end: number;
  elements: RenderElement[];
  /**
   * Full-screen black board scene: the backdrop starts fading in at `in` (so it's fully black
   * by the first stroke) and has faded back out to the speaker by `out` (= end).
   */
  board?: { in: number; out: number };
}

export interface RenderPlan {
  version: "2.0";
  fps: number;
  durationSeconds: number;
  width: number;
  height: number;
  theme: SketchTheme;
  /** For debugging overlays only. */
  regions: FreeRegion[];
  scenes: RenderScene[];
  /** Things the plan asked for that never got drawn (the scene ended before the pen got there). */
  dropped?: { sceneId: string; target: string; label: string; frame: number }[];
}
