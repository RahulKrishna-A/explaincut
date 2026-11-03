/**
 * Re-renders an already-processed job WITHOUT calling the Meta API: reuses
 * its transcript.json, SAM masks (masks/), sampled frames (frames/) and
 * input.mp4, so you can iterate on layout/animation in seconds.
 *
 * Usage:
 *   npx tsx scripts/rerender.ts <jobId> [--plan path/to/plan.json] [--regions] [--layer-only]
 *
 *   --plan        use this v2 plan instead of the job's diagram-plan.raw.json
 *   --regions     draw the detected free-space rectangles (debug)
 *   --layer-only  stop after rendering the transparent drawing layer
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
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Transcript } from "../types/transcript";
import type { RenderPlan } from "../types/diagramPlan";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function renderLayer(plan: RenderPlan, out: string, showRegions: boolean) {
  const propsPath = path.join(path.dirname(out), `.remotion-props-${randomUUID()}.json`);
  await fs.writeFile(propsPath, JSON.stringify({ renderPlan: plan, showRegions }));
  const bin = path.resolve(process.cwd(), "node_modules/.bin/remotion");
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(
        bin,
        ["render", "ExplainCut", out, `--props=${propsPath}`, "--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le"],
        { maxBuffer: 1024 * 1024 * 64 },
        (err, _o, stderr) => (err ? reject(new Error(stderr)) : resolve())
      )
    );
  } finally {
    await fs.unlink(propsPath).catch(() => {});
  }
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

  console.time("free space");
  const space = await analyzeFreeSpace(
    samples.map((s) => s.pngPath),
    samples.map((s) => s.framePath!),
    meta.width!,
    meta.height!
  );
  console.timeEnd("free space");
  console.log("free space:", JSON.stringify(space));

  const { plan, issues } = validateAndResolveDiagramPlan(rawPlan, transcript);
  if (issues.length) console.warn("plan issues:", issues);
  const renderPlan = buildRenderPlan(plan, space);
  await fs.writeFile(path.join(dir, "render-plan.json"), JSON.stringify(renderPlan, null, 2));
  console.log(`scenes: ${renderPlan.scenes.map((s) => `${s.id}[${s.elements.length}]`).join(" ")}`);

  const layer = path.join(dir, "diagram-layer-v2.mov");
  console.time("render layer");
  await renderLayer(renderPlan, layer, process.argv.includes("--regions"));
  console.timeEnd("render layer");
  if (process.argv.includes("--layer-only")) return;

  const maskVideo = await buildSmoothedMaskVideo(samples, dir, renderPlan.fps);
  const out = path.join(dir, "output-v2.mp4");
  await composeDiagramBehindPerson(path.join(dir, "input.mp4"), layer, maskVideo, out);
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
