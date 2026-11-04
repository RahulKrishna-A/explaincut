/**
 * Self-review: Muse Wonder watches the rendered cut, measured checks run
 * against the render plan + SAM masks, Muse Spark re-plans the flagged
 * scenes, the cut is re-rendered and every finding is re-verified.
 * The whole object is streamed to the client through the job status.
 */

export const CHECK_KINDS = ["relevance", "timing", "overlap"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_LABELS: Record<CheckKind, string> = {
  relevance: "Relevance",
  timing: "Timing",
  overlap: "Speaker overlap",
};

export type FindingStatus =
  | "found" // just flagged
  | "fixing" // Spark is re-planning its scene
  | "fixed" // verified gone after the re-render
  | "remaining" // still there after the re-render
  | "unverified" // re-planned, but the verification pass couldn't confirm either way
  | "minor"; // low severity - reported, not worth a re-render

export interface ReviewFinding {
  id: string;
  kind: CheckKind;
  severity: "low" | "medium" | "high";
  /** Who caught it: Muse Wonder looking at frames, or a measurement on the render plan / SAM masks. */
  source: "wonder" | "measured";
  sceneId?: string;
  /** Element id inside the render plan (measured findings), for re-checking after the fix. */
  elementId?: string;
  /** Human label of what's affected, e.g. "Vector store". */
  target?: string;
  /** Seconds into the video where it shows. */
  time: number;
  title: string;
  detail: string;
  suggestion?: string;
  status: FindingStatus;
  /** After the fix: what changed, e.g. "Now lands 0.1 s after the word". */
  resolution?: string;
  /** Thumbnail file names served by /api/frame/[jobId]/[name]. */
  beforeFrame?: string;
  afterFrame?: string;
}

export type ReviewPhase = "watching" | "fixing" | "rerendering" | "verifying" | "done" | "failed";

export interface ReviewCheckSummary {
  /** Issues found on the first cut. */
  found: number;
  /** Issues still open on the final cut. */
  open: number;
  note: string;
}

export interface SelfReview {
  phase: ReviewPhase;
  framesSampled: number;
  findings: ReviewFinding[];
  /** Live activity feed, newest last. */
  log: { at: number; text: string }[];
  checks?: Record<CheckKind, ReviewCheckSummary>;
  /** Scenes Muse Spark re-planned. */
  replannedScenes: string[];
  /** output-before.mp4 exists (the cut before fixes). */
  hasBefore: boolean;
  error?: string;
}
