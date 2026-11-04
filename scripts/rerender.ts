/**
 * Re-renders an already-processed job WITHOUT calling the Meta API: reuses
 * its transcript.json, SAM masks (masks/), sampled frames (frames/) and
 * input.mp4, so you can iterate on layout/animation in seconds.
 *
 * Usage:
 *   npx tsx scripts/rerender.ts <jobId> [--plan path/to/plan.json] [--regions] [--layer-only]
 *                                       [--captions | --no-captions] [--caption-font sans|rounded|serif|mono|hand] [--caption-size small|medium|large]
 *
 *   --plan          use this v2 plan instead of the job's diagram-plan.raw.json
 *   --regions       draw the detected free-space rectangles (debug)
 *   --layer-only    stop after rendering the transparent drawing layer
 *   --captions      burn in captions; --no-captions  leave them out
 *                   (otherwise the job's render-options.json, or the default: on)
 *   --caption-font  caption typeface; --caption-size  caption size
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { jobDir } from "../lib/paths";
import { analyzeFreeSpace } from "../lib/layout/freeSpace";
import { buildRenderPlan } from "../lib/layout/buildRenderPlan";
import { validateAndResolveDiagramPlan } from "../lib/diagramPlan/validate";
import { buildSmoothedMaskVideo, type MaskSample } from "../lib/ffmpeg/maskToAlpha";
import { composeDiagramBehindPerson } from "../lib/ffmpeg/composeMaskedSpeaker";
import { renderCaptionLayer, renderTransparentLayer } from "../lib/render/renderDiagramLayer";
import { captionMetrics, reserveCaptionBand } from "../lib/captions/buildCaptions";
import { parseRenderOptions } from "../lib/renderOptions";
import type { Transcript } from "../types/transcript";
import type { RenderPlan } from "../types/diagramPlan";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function renderLayer(plan: RenderPlan, out: string, showRegions: boolean) {
  return renderTransparentLayer("ExplainCut", { renderPlan: plan, showRegions }, out);
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId || jobId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/rerender.ts <jobId> [--plan plan.json] [--regions] [--layer-only]");
    process.exit(1);
  }
  const dir = jobDir(jobId);
  const transcript = JSON.parse(await fs.readFile(path.join(dir, "transcript.json"), "utf-8")) as Transcript;
  const planPath = arg("--plan") ?? path.join(dir, "diagram-plan.raw.json");
  const rawPlan = JSON.parse(await fs.readFile(planPath, "utf-8"));

  const maskFiles = (await fs.readdir(path.join(dir, "masks"))).filter((f) => f.endsWith(".png")).sort();
  const samples: MaskSample[] = maskFiles.map((f) => ({
    pngPath: path.join(dir, "masks", f),
    intervalSeconds: 0.4,
    framePath: path.join(dir, "frames", f),
  }));
  const meta = await sharp(samples[0].framePath!).metadata();

  const saved = await fs.readFile(path.join(dir, "render-options.json"), "utf-8").then(JSON.parse, () => ({}));
  const options = parseRenderOptions(saved);
  if (process.argv.includes("--captions")) options.captions.enabled = true;
  if (process.argv.includes("--no-captions")) options.captions.enabled = false;
  if (arg("--caption-font")) options.captions = parseRenderOptions({ captions: { ...options.captions, font: arg("--caption-font") } }).captions;
  if (arg("--caption-size")) options.captions = parseRenderOptions({ captions: { ...options.captions, size: arg("--caption-size") } }).captions;

  console.time("free space");
  let space = await analyzeFreeSpace(
    samples.map((s) => s.pngPath),
    samples.map((s) => s.framePath!),
    meta.width!,
    meta.height!
  );
  console.timeEnd("free space");
  if (options.captions.enabled) space = reserveCaptionBand(space, captionMetrics(space.width, space.height, options.captions).bandTop);
  console.log("free space:", JSON.stringify(space));

  const { plan, issues } = validateAndResolveDiagramPlan(rawPlan, transcript);
  if (issues.length) console.warn("plan issues:", issues);
  // Reuse the job's generated stickers (no API calls); a --plan with new sticker subjects just leaves those out.
  const stickers = await fs.readFile(path.join(dir, "stickers.json"), "utf-8").then(JSON.parse, () => ({}));
  const renderPlan = buildRenderPlan(plan, space, stickers);
  await fs.writeFile(path.join(dir, "render-plan.json"), JSON.stringify(renderPlan, null, 2));
  console.log(`scenes: ${renderPlan.scenes.map((s) => `${s.id}[${s.elements.length}]`).join(" ")}`);

  const layer = path.join(dir, "diagram-layer-v2.mov");
  console.time("render layer");
  await renderLayer(renderPlan, layer, process.argv.includes("--regions"));
  console.timeEnd("render layer");
  if (process.argv.includes("--layer-only")) return;

  let captionLayer: string | undefined;
  if (options.captions.enabled) {
    captionLayer = path.join(dir, "caption-layer-v2.mov");
    console.time("render captions");
    await renderCaptionLayer(transcript, options.captions, { width: renderPlan.width, height: renderPlan.height, fps: renderPlan.fps }, captionLayer);
    console.timeEnd("render captions");
  }

  const maskVideo = await buildSmoothedMaskVideo(samples, dir, renderPlan.fps);
  const out = path.join(dir, "output-v2.mp4");
  await composeDiagramBehindPerson(path.join(dir, "input.mp4"), layer, maskVideo, out, captionLayer);
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
