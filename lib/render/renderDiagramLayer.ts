import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RenderPlan } from "@/types/diagramPlan";
import type { Transcript } from "@/types/transcript";
import type { CaptionSettings } from "@/types/renderOptions";

const REMOTION_BIN = path.resolve(process.cwd(), "node_modules/.bin/remotion");

/**
 * Renders the diagram-only layer by shelling out to the Remotion CLI (the
 * exact command proven to work in manual testing) rather than importing
 * @remotion/bundler/@remotion/renderer into the Next.js server bundle -
 * Turbopack can't statically bundle their native deps (rspack bindings,
 * esbuild platform packages), so a subprocess is both simpler and more
 * reliable than fighting the bundler.
 *
 * Output is ProRes 4444 (.mov) with a REAL alpha channel - the composition
 * has no background at all, so only the diagram elements themselves are
 * opaque. This lets ffmpeg punch a person-shaped hole in it and composite
 * the result onto the untouched original video (see pipeline.ts) instead of
 * replacing the real background with a synthetic one.
 */
/** Renders any registered composition to a ProRes 4444 .mov with a real alpha channel. */
export async function renderTransparentLayer(compositionId: string, props: Record<string, unknown>, outputPath: string): Promise<void> {
  const propsPath = path.join(path.dirname(outputPath), `.remotion-props-${randomUUID()}.json`);
  await fs.writeFile(propsPath, JSON.stringify(props));

  const args = [
    "render",
    compositionId,
    outputPath,
    `--props=${propsPath}`,
    "--codec=prores",
    "--prores-profile=4444",
    "--pixel-format=yuva444p10le",
  ];
  // Width/height/fps come from the props (calculateMetadata), which are
  // built at the speaker video's own resolution, so the later ffmpeg
  // overlay/alphamerge composites align pixel-for-pixel.

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        REMOTION_BIN,
        args,
        { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 64 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`remotion render ${compositionId} failed:\n${stderr}`));
            return;
          }
          resolve();
        }
      );
    });
  } finally {
    await fs.unlink(propsPath).catch(() => {});
  }
}

export async function renderDiagramLayer(renderPlan: RenderPlan, outputPath: string): Promise<void> {
  await renderTransparentLayer("ExplainCut", { renderPlan, showRegions: false }, outputPath);
}

/** Word-timed captions on transparency, composited over the speaker (never punched out). */
export async function renderCaptionLayer(
  transcript: Transcript,
  settings: CaptionSettings,
  video: { width: number; height: number; fps: number },
  outputPath: string
): Promise<void> {
  await renderTransparentLayer(
    "Captions",
    { words: transcript.words, settings, ...video, durationSeconds: transcript.durationSeconds },
    outputPath
  );
}
