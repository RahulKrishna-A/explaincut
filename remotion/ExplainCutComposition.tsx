import React from "react";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
import type { RenderPlan } from "@/types/diagramPlan";
import type { Transcript } from "@/types/transcript";
import { validateAndResolveDiagramPlan } from "@/lib/diagramPlan/validate";
import { buildRenderPlan } from "@/lib/layout/buildRenderPlan";
import { defaultFreeSpace } from "@/lib/layout/defaultFreeSpace";
import { SketchRenderer } from "./SketchRenderer";

import flowExample from "@/lib/diagramPlan/sample-plans/flow-example.json";
import demoTranscript from "@/data/fixtures/demo-transcript.json";

export type ExplainCutProps = {
  renderPlan: RenderPlan;
  /** Debug: outline the detected free-space regions. */
  showRegions?: boolean;
} & Record<string, unknown>;

function buildPreviewDefaultProps(): ExplainCutProps {
  const { plan } = validateAndResolveDiagramPlan(flowExample, demoTranscript as Transcript);
  return { renderPlan: buildRenderPlan(plan, defaultFreeSpace(1080, 1920)), showRegions: true };
}

export const explainCutDefaultProps: ExplainCutProps = buildPreviewDefaultProps();

export const calculateExplainCutMetadata: CalculateMetadataFunction<ExplainCutProps> = ({ props }) => {
  const plan = props.renderPlan;
  return {
    durationInFrames: Math.max(1, Math.round(plan.durationSeconds * plan.fps)),
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
  };
};

/**
 * Renders ONLY the hand-drawn layer on a fully transparent background. ffmpeg
 * later composites it over the untouched original video and punches out the
 * speaker (SAM mask), so the drawing lives in the free space around them and
 * tucks behind them wherever it does overlap. See lib/ffmpeg/composeMaskedSpeaker.ts.
 */
export const ExplainCutComposition: React.FC<ExplainCutProps> = ({ renderPlan, showRegions }) => {
  return (
    <AbsoluteFill>
      <SketchRenderer plan={renderPlan} showRegions={showRegions} />
    </AbsoluteFill>
  );
};
