import fs from "node:fs/promises";
import sharp from "sharp";
import { jobDir, jobFile } from "./paths";
import { getJob, updateJob, setJobError } from "./jobs";
import { transcribeVideo } from "./meta/transcribe";
import { generateDiagramPlan } from "./meta/spark";
import { validateAndResolveDiagramPlan } from "./diagramPlan/validate";
import { renderCaptionLayer, renderDiagramLayer } from "./render/renderDiagramLayer";
import { captionMetrics, reserveCaptionBand } from "./captions/buildCaptions";
import { DEFAULT_RENDER_OPTIONS } from "@/types/renderOptions";
import { buildMaskSamples } from "./segmentation/buildMaskSamples";
import { buildSmoothedMaskVideo, type MaskSample } from "./ffmpeg/maskToAlpha";
import { composeDiagramBehindPerson, composeDiagramOverlay } from "./ffmpeg/composeMaskedSpeaker";
import { getVideoDimensions } from "./ffmpeg/run";
import { analyzeFreeSpace } from "./layout/freeSpace";
import { defaultFreeSpace } from "./layout/defaultFreeSpace";
import { buildRenderPlan } from "./layout/buildRenderPlan";
import { runSelfReview } from "./review/selfReview";
import { prepareStickers } from "./stickers/prepare";
import flowExample from "./diagramPlan/sample-plans/flow-example.json";
import type { Transcript } from "@/types/transcript";
import type { FreeSpace, RenderPlan } from "@/types/diagramPlan";

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
  const options = getJob(jobId)?.options ?? DEFAULT_RENDER_OPTIONS;
  const captions = options.captions;
  const notes: string[] = [];

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(jobFile(jobId, "render-options.json"), JSON.stringify(options, null, 2));
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
    let space = await resolveFreeSpace(inputPath, maskSamples);
    // Captions own the bottom band - keep drawings out of it.
    if (captions.enabled) space = reserveCaptionBand(space, captionMetrics(space.width, space.height, captions).bandTop);
    await fs.writeFile(jobFile(jobId, "free-space.json"), JSON.stringify(space, null, 2));

    updateJob(jobId, { stage: "planning" });
    const { plan: resolvedPlan, issues, raw } = await generatePlanWithFallback(transcript, space);
    if (issues.length > 0) console.warn(`Job ${jobId} diagram plan issues:`, issues);
    await fs.writeFile(jobFile(jobId, "diagram-plan.raw.json"), JSON.stringify(raw, null, 2));
    await fs.writeFile(jobFile(jobId, "diagram-plan.resolved.json"), JSON.stringify(resolvedPlan, null, 2));

    // Stickers: small Muse Image illustrations the plan asked for (only where they add context).
    updateJob(jobId, { stage: "illustrating" });
    const prepared = await prepareStickers(resolvedPlan);
    let stickers = prepared.assets;
    const failed = prepared.failed;
    if (failed.length > 0) console.warn(`Job ${jobId}: ${failed.length} sticker(s) left out:`, failed);
    await fs.writeFile(jobFile(jobId, "stickers.json"), JSON.stringify(stickers));

    const renderPlan = buildRenderPlan(resolvedPlan, space, stickers);
    await fs.writeFile(jobFile(jobId, "render-plan.json"), JSON.stringify(renderPlan, null, 2));

    updateJob(jobId, { stage: "rendering_diagram" });
    // Captions don't depend on the plan, so render them once - the self-review loop reuses them.
    let captionLayerPath: string | undefined;
    if (captions.enabled) {
      try {
        captionLayerPath = jobFile(jobId, "caption-layer.mov");
        await renderCaptionLayer(
          transcript,
          captions,
          { width: renderPlan.width, height: renderPlan.height, fps: renderPlan.fps },
          captionLayerPath
        );
      } catch (err) {
        console.error(`Caption render failed for job ${jobId} (continuing without captions):`, err);
        captionLayerPath = undefined;
        notes.push("Captions couldn't be rendered for this clip.");
      }
    }

    const outputPath = jobFile(jobId, "output.mp4");
    const diagramLayerPath = jobFile(jobId, "diagram-layer.mov");
    let maskVideoPath: string | null | undefined; // undefined = not built yet, null = unavailable
    let usedMasking = false;

    /** Draw the layer and composite it onto the original. Run once, and again by the self-review fix. */
    const renderAndCompose = async (plan: RenderPlan) => {
      await renderDiagramLayer(plan, diagramLayerPath);
      updateJob(jobId, { stage: getJob(jobId)?.stage === "correcting" ? "correcting" : "compositing" });
      if (maskVideoPath === undefined) {
        maskVideoPath = null;
        if (maskSamples) {
          try {
            maskVideoPath = await buildSmoothedMaskVideo(maskSamples, dir, plan.fps);
          } catch (err) {
            console.error(`Mask video failed for job ${jobId} - overlaying without a punch-out:`, err);
          }
        }
      }
      usedMasking = false;
      if (maskVideoPath) {
        try {
          await composeDiagramBehindPerson(inputPath, diagramLayerPath, maskVideoPath, outputPath, captionLayerPath);
          usedMasking = true;
        } catch (err) {
          console.error(`Masked composite failed for job ${jobId} - overlaying without a punch-out:`, err);
        }
      }
      if (!usedMasking) await composeDiagramOverlay(inputPath, diagramLayerPath, outputPath, captionLayerPath);
    };

    await renderAndCompose(renderPlan);

    if (options.selfReview.enabled) {
      updateJob(jobId, { stage: "reviewing" });
      try {
        const result = await runSelfReview({
          dir,
          transcript,
          space,
          rawPlan: raw,
          renderPlan,
          maskSamples,
          outputPath,
          simulate: (draftRaw) => {
            const { plan } = validateAndResolveDiagramPlan(draftRaw, transcript);
            if (plan.scenes.length === 0) throw new Error("draft plan resolved to zero scenes");
            // Stickers already generated are laid out too; new sticker subjects in a draft are only generated if it's rendered.
            return buildRenderPlan(plan, space, stickers);
          },
          rerender: async (revisedRaw) => {
            const { plan, issues: revIssues } = validateAndResolveDiagramPlan(revisedRaw, transcript);
            if (plan.scenes.length === 0) throw new Error("revised plan resolved to zero scenes");
            if (revIssues.length > 0) console.warn(`Job ${jobId} revised plan issues:`, revIssues);
            // Only stickers the revision newly asks for get generated.
            ({ assets: stickers } = await prepareStickers(plan, stickers));
            await fs.writeFile(jobFile(jobId, "stickers.json"), JSON.stringify(stickers));
            const revisedRender = buildRenderPlan(plan, space, stickers);
            await renderAndCompose(revisedRender);
            return { renderPlan: revisedRender, rawPlan: revisedRaw };
          },
          publish: (selfReview, stage) => updateJob(jobId, { selfReview, stage }),
        });
        updateJob(jobId, { selfReview: result.review });
        if (result.rawPlan !== raw) {
          await fs.writeFile(jobFile(jobId, "diagram-plan.raw.before.json"), JSON.stringify(raw, null, 2));
          await fs.writeFile(jobFile(jobId, "diagram-plan.raw.json"), JSON.stringify(result.rawPlan, null, 2));
          await fs.writeFile(jobFile(jobId, "render-plan.json"), JSON.stringify(result.renderPlan, null, 2));
        }
        await fs.writeFile(jobFile(jobId, "self-review.json"), JSON.stringify(result.review, null, 2));
      } catch (err) {
        // The first cut is already on disk - a failed review never costs the user their video.
        console.error(`Self-review failed for job ${jobId} (keeping the first cut):`, err);
        const prev = getJob(jobId)?.selfReview;
        updateJob(jobId, {
          selfReview: {
            ...(prev ?? { framesSampled: 0, findings: [], log: [], replannedScenes: [], hasBefore: false }),
            phase: "failed",
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (!usedMasking) notes.unshift("Segmentation failed - drawings may overlap you until that's fixed.");
    updateJob(jobId, {
      stage: "done",
      outputReady: true,
      message: notes.length > 0 ? notes.join(" ") : undefined,
    });
  } catch (err) {
    setJobError(jobId, err);
  }
}
