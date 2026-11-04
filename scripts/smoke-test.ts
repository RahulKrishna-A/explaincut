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
import { elementBounds, measureTiming } from "../lib/review/measure";
import { buildCaptionPages, captionMetrics } from "../lib/captions/buildCaptions";
import { DEFAULT_RENDER_OPTIONS } from "../types/renderOptions";
import type { Transcript } from "../types/transcript";

import flowExample from "../lib/diagramPlan/sample-plans/flow-example.json";
import agentMemoryPlan from "../data/fixtures/agent-memory-plan.json";
import ragExample from "../lib/diagramPlan/sample-plans/rag-example.json";
import chartExample from "../lib/diagramPlan/sample-plans/chart-example.json";
import demoTranscript from "../data/fixtures/demo-transcript.json";

const WORK_DIR = path.resolve(process.cwd(), "data/fixtures/.smoke-test");
const DEMO_CLIP = path.resolve(process.cwd(), "data/fixtures/demo-clip.mp4");

/**
 * Pure checks, no rendering: every sample plan (all layouts + charts) lays out
 * in portrait and landscape with every element inside the frame; captions
 * page; the self-review's measured checks run.
 */
function layoutChecks() {
  const transcript = demoTranscript as Transcript;
  const plans = { flowExample, agentMemoryPlan, ragExample, chartExample };
  let elements = 0;
  for (const [name, raw] of Object.entries(plans)) {
    // Sample plans were written against longer transcripts - stretch the demo one so every op resolves.
    const words = Array.from({ length: 120 }, (_, i) => ({ word: `w${i}`, startSeconds: i * 0.4, endSeconds: i * 0.4 + 0.3 }));
    const { plan } = validateAndResolveDiagramPlan(raw, { ...transcript, words, durationSeconds: 48 });
    for (const [w, h] of [[1080, 1920], [1920, 1080]]) {
      const rp = buildRenderPlan(plan, defaultFreeSpace(w, h));
      for (const el of rp.scenes.flatMap((s) => s.elements)) {
        const b = elementBounds(el);
        elements++;
        if (b && (b.x < -1 || b.y < -1 || b.x + b.w > w + 1 || b.y + b.h > h + 1)) {
          throw new Error(`${name} ${w}x${h}: element ${el.id} (${el.kind}) is outside the frame: ${JSON.stringify(b)}`);
        }
      }
      measureTiming(rp);
    }
  }
  const settings = { ...DEFAULT_RENDER_OPTIONS.captions, enabled: true };
  const pages = buildCaptionPages(transcript.words, captionMetrics(1080, 1920, settings), settings.font);
  if (pages.length === 0) throw new Error("captions produced no pages");
  console.log(`  ${Object.keys(plans).length} sample plans x 2 orientations: ${elements} elements in frame; ${pages.length} caption pages`);
}

async function main() {
  await fs.mkdir(WORK_DIR, { recursive: true });

  console.log("1/4 Layout, caption and review checks (no rendering)…");
  layoutChecks();

  console.log("2/4 Validating + resolving the flow-example diagram plan…");
  const { plan, issues } = validateAndResolveDiagramPlan(flowExample, demoTranscript as Transcript);
  if (issues.length > 0) console.warn("  validation issues:", issues);
  const opCount = plan.scenes.reduce((n, sc) => n + sc.ops.length, 0);
  console.log(`  resolved ${plan.scenes.length} scene(s), ${opCount} ops, duration ${plan.durationSeconds}s`);

  console.log("3/4 Rendering the hand-drawn layer via Remotion (ProRes 4444, real alpha)…");
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

  console.log("\n4/4 Building mask samples + compositing onto the original video…");
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
