import type { RenderOptions } from "./renderOptions";
import type { SelfReview } from "./review";

export type JobStage =
  | "uploaded"
  | "transcribing"
  | "planning"
  | "illustrating"
  | "rendering_diagram"
  | "segmenting"
  | "compositing"
  | "reviewing"
  | "correcting"
  | "done"
  | "error";

export interface JobStatus {
  id: string;
  stage: JobStage;
  message?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  outputReady: boolean;
  options?: RenderOptions;
  /** When the current stage began (ms epoch). */
  stageStartedAt?: number;
  /** Wall-clock milliseconds spent in each stage so far. */
  timings?: Partial<Record<JobStage, number>>;
  selfReview?: SelfReview;
}
