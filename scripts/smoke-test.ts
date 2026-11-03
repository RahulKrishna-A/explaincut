/**
 * End-to-end smoke test that exercises the Remotion + ffmpeg machinery WITHOUT
 * calling the Meta Model API - uses the hand-written fixtures for the
 * transcript/plan, and the SAM/no-key fallback (center-ellipse mask) if no
 * demo clip is present. Run with: npx tsx scripts/smoke-test.ts
 *
 * Drop a short real talking-head clip at data/fixtures/demo-clip.mp4 to also
 * exercise the full composite chain (person punch-out onto the original video).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { validateAndResolveDiagramPlan } from "../lib/diagramPlan/validate";
import { renderDiagramLayer } from "../lib/render/renderDiagramLayer";
import { buildRenderPlan } from "../lib/layout/buildRenderPlan";
import { defaultFreeSpace } from "../lib/layout/defaultFreeSpace";
import { buildMaskSamples } from "../lib/segmentation/buildMaskSamples";
import { buildSmoothedMaskVideo } from "../lib/ffmpeg/maskToAlpha";
import { composeDiagramBehindPerson } from "../lib/ffmpeg/composeMaskedSpeaker";
import type { Transcript } from "../types/transcript";

import flowExample from "../lib/diagramPlan/sample-plans/flow-example.json";
import demoTranscript from "../data/fixtures/demo-transcript.json";

const WORK_DIR = path.resolve(process.cwd(), "data/fixtures/.smoke-test");
const DEMO_CLIP = path.resolve(process.cwd(), "data/fixtures/demo-clip.mp4");

async function main() {
  await fs.mkdir(WORK_DIR, { recursive: true });

  console.log("1/2 Validating + resolving the flow-example diagram plan…");
  const { plan, issues } = validateAndResolveDiagramPlan(flowExample, demoTranscript as Transcript);
  if (issues.length > 0) console.warn("  validation issues:", issues);
  const opCount = plan.scenes.reduce((n, sc) => n + sc.ops.length, 0);
  console.log(`  resolved ${plan.scenes.length} scene(s), ${opCount} ops, duration ${plan.durationSeconds}s`);

  console.log("2/2 Rendering the hand-drawn layer via Remotion (ProRes 4444, real alpha)…");
  const renderPlan = buildRenderPlan(plan, defaultFreeSpace(1280, 720));
  const diagramLayerPath = path.join(WORK_DIR, "diagram-layer.mov");
  await renderDiagramLayer(renderPlan, diagramLayerPath);
  console.log(`  wrote ${diagramLayerPath}`);

  const hasDemoClip = await fs
    .access(DEMO_CLIP)
    .then(() => true)
    .catch(() => false);

  if (!hasDemoClip) {
    console.log(
      `\nNo demo clip found at ${DEMO_CLIP} - skipping composite checks.\n` +
        "Drop a short self-recorded clip there and re-run to exercise the full chain."
    );
    return;
  }

  console.log("\n3/3 Building mask samples + compositing onto the original video…");
  const maskSamples = await buildMaskSamples(DEMO_CLIP, WORK_DIR);
  const maskVideoPath = await buildSmoothedMaskVideo(maskSamples, WORK_DIR, plan.fps);
  const outputPath = path.join(WORK_DIR, "output.mp4");
  await composeDiagramBehindPerson(DEMO_CLIP, diagramLayerPath, maskVideoPath, outputPath);
  console.log(`  wrote ${outputPath}`);

  console.log("\nAll smoke-test stages completed. Check data/fixtures/.smoke-test/ for outputs.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
