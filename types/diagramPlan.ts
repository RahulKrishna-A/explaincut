/**
 * Diagram plan v2.
 *
 * Three layers of data:
 *  1. DiagramPlan         - raw, semantic output from Muse Spark (what to draw, and on which word).
 *  2. ResolvedDiagramPlan - validated; every op's trigger resolved to a real transcript frame.
 *  3. RenderPlan          - fully laid out in pixels inside the speaker's free space, with every
 *                           element's start frame/duration decided. This is all Remotion consumes.
 */

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

export const SCENE_LAYOUTS = ["flow", "hub", "stack", "cycle", "compare"] as const;
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

export interface DiagramScene {
  id: string;
  layout: SceneLayout;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  ops: DiagramOp[];
}

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

export type MarkType = "circle" | "underline" | "highlight" | "check" | "cross" | "sparkle" | "divider";

export interface MarkElement extends ElementBase {
  kind: "mark";
  mark: MarkType;
  target: Rect;
  targetShape: NodeShape;
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

export type RenderElement = NodeElement | EdgeElement | PacketElement | MarkElement | TextElement;

export interface RenderScene {
  id: string;
  start: number;
  /** Frame the scene is fully erased by (Infinity-like for the last scene: durationInFrames). */
  end: number;
  elements: RenderElement[];
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
}
