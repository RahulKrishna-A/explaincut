import fs from "node:fs/promises";
import sharp from "sharp";
import { jobDir, jobFile } from "./paths";
import { updateJob, setJobError } from "./jobs";
import { transcribeVideo } from "./meta/transcribe";
import { generateDiagramPlan } from "./meta/spark";
import { validateAndResolveDiagramPlan } from "./diagramPlan/validate";
import { renderDiagramLayer } from "./render/renderDiagramLayer";
import { buildMaskSamples } from "./segmentation/buildMaskSamples";
import { buildSmoothedMaskVideo, type MaskSample } from "./ffmpeg/maskToAlpha";
import { composeDiagramBehindPerson, composeDiagramOverlay } from "./ffmpeg/composeMaskedSpeaker";
import { extractFrames } from "./ffmpeg/extractFrames";
import { getVideoDimensions } from "./ffmpeg/run";
import { analyzeFreeSpace } from "./layout/freeSpace";
import { defaultFreeSpace } from "./layout/defaultFreeSpace";
import { buildRenderPlan } from "./layout/buildRenderPlan";
import { reviewRender, type WonderIssue } from "./meta/wonder";
import flowExample from "./diagramPlan/sample-plans/flow-example.json";
import type { Transcript } from "@/types/transcript";
import type { FreeSpace } from "@/types/diagramPlan";

const ENABLE_WONDER_REVIEW = process.env.ENABLE_WONDER_REVIEW === "true";

async function generatePlanWithFallback(transcript: Transcript, space: FreeSpace) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateDiagramPlan(transcript, space);
      const result = validateAndResolveDiagramPlan(raw, transcript);
      if (result.plan.scenes.length > 0) return { ...result, raw };
      throw new Error("plan resolved to zero scenes");
    } catch (err) {
      console.error(`Diagram plan attempt ${attempt + 1} failed:`, err);
    }
  }
  console.error("Both Muse Spark attempts failed - falling back to the sample plan, spread across the real transcript.");
  return { ...validateAndResolveDiagramPlan(flowExample, transcript), raw: flowExample };
}

/**
 * Where can we draw? Works out the speaker's footprint from the SAM masks.
 * Frame size comes from the extracted frames themselves (they're already
 * rotation-corrected, unlike the container's coded size).
 */
async function resolveFreeSpace(inputPath: string, samples: MaskSample[] | null): Promise<FreeSpace> {
  const framePaths = (samples ?? []).map((s) => s.framePath).filter((p): p is string => !!p);
  let dims: { width: number; height: number };
  if (framePaths[0]) {
    const meta = await sharp(framePaths[0]).metadata();
    dims = { width: meta.width ?? 0, height: meta.height ?? 0 };
  } else {
    dims = await getVideoDimensions(inputPath);
  }
  if (!samples || samples.length === 0) return defaultFreeSpace(dims.width, dims.height);
  return analyzeFreeSpace(
    samples.map((s) => s.pngPath),
    framePaths,
    dims.width,
    dims.height
  );
}

export async function runPipeline(jobId: string): Promise<void> {
  const dir = jobDir(jobId);
  const inputPath = jobFile(jobId, "input.mp4");

  try {
    updateJob(jobId, { stage: "transcribing" });
    const transcript = await transcribeVideo(inputPath);
    await fs.writeFile(jobFile(jobId, "transcript.json"), JSON.stringify(transcript, null, 2));

    // Segment FIRST: the planner and the layout both need to know where the
    // speaker is, so drawings land in the empty space around them.
    updateJob(jobId, { stage: "segmenting" });
    let maskSamples: MaskSample[] | null = null;
    try {
      maskSamples = await buildMaskSamples(inputPath, dir);
    } catch (err) {
      console.error(`Segmentation failed for job ${jobId} - using a default free-space guess:`, err);
    }
    const space = await resolveFreeSpace(inputPath, maskSamples);
    await fs.writeFile(jobFile(jobId, "free-space.json"), JSON.stringify(space, null, 2));

    updateJob(jobId, { stage: "planning" });
    const { plan: resolvedPlan, issues, raw } = await generatePlanWithFallback(transcript, space);
    if (issues.length > 0) console.warn(`Job ${jobId} diagram plan issues:`, issues);
    await fs.writeFile(jobFile(jobId, "diagram-plan.raw.json"), JSON.stringify(raw, null, 2));
    await fs.writeFile(jobFile(jobId, "diagram-plan.resolved.json"), JSON.stringify(resolvedPlan, null, 2));

    const renderPlan = buildRenderPlan(resolvedPlan, space);
    await fs.writeFile(jobFile(jobId, "render-plan.json"), JSON.stringify(renderPlan, null, 2));

    updateJob(jobId, { stage: "rendering_diagram" });
    const diagramLayerPath = jobFile(jobId, "diagram-layer.mov");
    await renderDiagramLayer(renderPlan, diagramLayerPath);

    updateJob(jobId, { stage: "compositing" });
    const outputPath = jobFile(jobId, "output.mp4");
    let usedMasking = false;
    if (maskSamples) {
      try {
        const maskVideoPath = await buildSmoothedMaskVideo(maskSamples, dir, renderPlan.fps);
        await composeDiagramBehindPerson(inputPath, diagramLayerPath, maskVideoPath, outputPath);
        usedMasking = true;
      } catch (err) {
        console.error(`Masked composite failed for job ${jobId} - overlaying without a punch-out:`, err);
      }
    }
    if (!usedMasking) await composeDiagramOverlay(inputPath, diagramLayerPath, outputPath);

    let reviewIssues: WonderIssue[] = [];
    if (ENABLE_WONDER_REVIEW) {
      updateJob(jobId, { stage: "reviewing" });
      try {
        const reviewFramesDir = jobFile(jobId, "review-frames");
        const interval = Math.max(1, transcript.durationSeconds / 4);
        const frames = await extractFrames(outputPath, reviewFramesDir, interval);
        const base64Frames = await Promise.all(
          frames.slice(0, 4).map(async (f) => (await fs.readFile(f.path)).toString("base64"))
        );
        reviewIssues = await reviewRender(transcript, renderPlan, base64Frames);
      } catch (err) {
        console.error(`Wonder review failed for job ${jobId} (non-fatal):`, err);
      }
    }

    updateJob(jobId, {
      stage: "done",
      outputReady: true,
      reviewIssues,
      message: usedMasking ? undefined : "Segmentation failed - drawings may overlap you until that's fixed.",
    });
  } catch (err) {
    setJobError(jobId, err);
  }
}
