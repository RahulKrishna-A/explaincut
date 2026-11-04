import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
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
function runRemotion(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(REMOTION_BIN, args, { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (!err) return resolve();
      // A process killed for memory (SIGKILL) prints nothing - say how it ended, and include
      // stdout too: the CLI writes some errors there.
      const how = err.killed || err.signal ? `killed by ${err.signal ?? "signal"} (out of memory?)` : `exit code ${err.code ?? "?"}`;
      const tail = (s: string) => s.trim().split("\n").slice(-40).join("\n");
      reject(new Error(`remotion ${args.slice(0, 2).join(" ")} failed (${how}):\n${tail(stderr) || "(no stderr)"}\n--- stdout ---\n${tail(stdout) || "(no stdout)"}`));
    });
  });
}

/** Everything the Remotion bundle is built from (compositions import shared layout code and types). */
const BUNDLE_SOURCES = ["remotion", "lib", "types", "data/fixtures", "remotion.config.ts", "package-lock.json"];

/** Cheap fingerprint of the bundle's sources (paths + mtimes), so a changed file means a fresh bundle. */
async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha1");
  const walk = async (p: string): Promise<void> => {
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(p)).sort()) await walk(path.join(p, entry));
    } else if (/\.(tsx?|json|css)$/.test(p)) {
      hash.update(`${p}:${stat.mtimeMs}\n`);
    }
  };
  // Source tree read at runtime for fingerprinting only - not something to trace into the server bundle.
  for (const src of BUNDLE_SOURCES) await walk(path.resolve(/*turbopackIgnore: true*/ process.cwd(), src));
  return hash.digest("hex").slice(0, 12);
}

const bundles = new Map<string, Promise<string>>();

/**
 * Bundles the Remotion project once and reuses it for every render (each
 * `remotion render <entry>` would otherwise re-run webpack - ~2 s per layer,
 * and a job renders 2-3 layers). Keyed by a source fingerprint, so editing a
 * composition during development still picks up the change.
 */
async function remotionBundle(): Promise<string> {
  // Production images bundle once at build time (see Dockerfile), so the server never runs webpack.
  const prebuilt = process.env.REMOTION_BUNDLE_DIR;
  if (prebuilt && (await fs.stat(path.join(prebuilt, "index.html")).then(() => true, () => false))) return prebuilt;
  const key = await sourceFingerprint();
  let bundle = bundles.get(key);
  if (!bundle) {
    const outDir = path.join(os.tmpdir(), "explaincut-remotion", key);
    bundle = (async () => {
      const ready = await fs.stat(path.join(outDir, "index.html")).then(() => true, () => false);
      if (!ready) await runRemotion(["bundle", `--out-dir=${outDir}`, "--log=error"]);
      return outDir;
    })();
    bundle.catch(() => bundles.delete(key));
    bundles.set(key, bundle);
  }
  return bundle;
}

/** Renders any registered composition to a ProRes 4444 .mov with a real alpha channel. */
export async function renderTransparentLayer(compositionId: string, props: Record<string, unknown>, outputPath: string): Promise<void> {
  const propsPath = path.join(path.dirname(outputPath), `.remotion-props-${randomUUID()}.json`);
  await fs.writeFile(propsPath, JSON.stringify(props));

  const args = [
    "render",
    await remotionBundle(),
    compositionId,
    outputPath,
    `--props=${propsPath}`,
    "--codec=prores",
    "--prores-profile=4444",
    "--pixel-format=yuva444p10le",
    // Containers (Railway) have a tiny /dev/shm and tight memory: Remotion's shared-memory
    // frame hand-off to FFmpeg dies there. The screenshot path is slower but dependable
    // (PNG screenshots: the only format that keeps the alpha channel). Default concurrency
    // opens one Chrome tab per CPU core, each buffering full-res RGBA frames plus the
    // prores_ks encoder's own buffers - on a small instance that adds up and the OOM
    // killer SIGKILLs ffmpeg mid-render; one tab at a time keeps peak memory bounded.
    ...(process.env.REMOTION_DISABLE_SHARED_MEMORY === "1" ? ["--disable-shared-memory-capture", "--image-format=png", "--concurrency=1"] : []),
  ];
  // Width/height/fps come from the props (calculateMetadata), which are
  // built at the speaker video's own resolution, so the later ffmpeg
  // overlay/alphamerge composites align pixel-for-pixel.

  try {
    await runRemotion(args);
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
