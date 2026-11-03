import type { WonderIssue } from "@/lib/meta/wonder";

export type JobStage =
  | "uploaded"
  | "transcribing"
  | "planning"
  | "rendering_diagram"
  | "segmenting"
  | "compositing"
  | "reviewing"
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
  reviewIssues?: WonderIssue[];
}
