/**
 * The self-correcting loop:
 *
 *   1. WATCH   - measured checks (timing vs. the transcript, overlap vs. the SAM
 *                masks) + Muse Wonder looking at sampled frames of the real cut.
 *   2. FIX     - Muse Spark gets its own plan and the findings, and re-plans the
 *                flagged scenes (other scenes are kept exactly).
 *   3. RENDER  - the revised plan is laid out, drawn and composited again.
 *   4. VERIFY  - measured checks re-run on the new plan; Wonder takes a second
 *                look at the same moments and rules on each finding.
 *
 * Every step is published as it happens so the app can show the fix live.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RenderPlan } from "@/types/diagramPlan";
import type { Transcript } from "@/types/transcript";
import type { FreeSpace } from "@/types/diagramPlan";
import type { CheckKind, ReviewFinding, SelfReview } from "@/types/review";
import { CHECK_KINDS } from "@/types/review";
import type { MaskSample } from "@/lib/ffmpeg/maskToAlpha";
import { runFfmpeg } from "@/lib/ffmpeg/run";
import { reviewWithWonder, verifyWithWonder, type ReviewFrame, type WonderFinding } from "@/lib/meta/wonder";
import { replanScenes } from "@/lib/meta/spark";
import {
  describeOverlapNow,
  describeTimingNow,
  loadMasks,
  measureOverlap,
  measureTiming,
  type MeasuredFinding,
} from "./measure";

const MAX_FRAMES = 10;
const ERASE_SECONDS = 0.45;

export interface SelfReviewDeps {
  dir: string;
  transcript: Transcript;
  space: FreeSpace;
  rawPlan: unknown;
  renderPlan: RenderPlan;
  maskSamples: MaskSample[] | null;
  outputPath: string;
  /** Validates + lays out a raw plan without rendering (for checking drafts). Throws if the plan is unusable. */
  simulate: (rawPlan: unknown) => RenderPlan;
  /** Lays out, renders and composites a revised raw plan over outputPath. Throws if the plan is unusable. */
  rerender: (rawPlan: unknown) => Promise<{ renderPlan: RenderPlan; rawPlan: unknown }>;
  publish: (review: SelfReview, stage: "reviewing" | "correcting") => void;
}

export interface SelfReviewResult {
  review: SelfReview;
  /** The plan that produced the final output (the revised one if a fix was applied). */
  rawPlan: unknown;
  renderPlan: RenderPlan;
}

async function grabFrame(video: string, t: number, out: string): Promise<string> {
  await runFfmpeg(["-y", "-ss", Math.max(0, t).toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out]);
  return (await fs.readFile(out)).toString("base64");
}

/** When to look: as each scene's drawing completes, mid-scene, and wherever a measurement flagged something. */
function pickSampleTimes(plan: RenderPlan, extra: number[]): number[] {
  const { fps } = plan;
  const times: number[] = [...extra];
  for (const scene of plan.scenes) {
    const lastVisible = (scene.end - ERASE_SECONDS * fps) / fps - 0.1;
    const ends = scene.elements.map((e) => (e.start + e.duration) / fps).sort((a, b) => a - b);
    const settled = ends[Math.floor(ends.length * 0.85)] ?? scene.start / fps;
    times.push(Math.min(settled + 0.2, lastVisible));
    times.push(Math.min((scene.start / fps + settled) / 2, lastVisible));
  }
  const maxT = plan.durationSeconds - 0.1;
  const sorted = [...new Set(times.map((t) => Math.max(0, Math.min(maxT, Math.round(t * 10) / 10))))].sort((a, b) => a - b);
  const deduped = sorted.filter((t, i) => i === 0 || t - sorted[i - 1] >= 0.6);
  if (deduped.length <= MAX_FRAMES) return deduped;
  // Keep the flagged moments, thin out the rest evenly.
  const must = new Set(extra.map((t) => Math.round(t * 10) / 10));
  const keep = deduped.filter((t) => must.has(t)).slice(0, MAX_FRAMES);
  const rest = deduped.filter((t) => !must.has(t));
  const step = rest.length / Math.max(1, MAX_FRAMES - keep.length);
  for (let i = 0; keep.length < MAX_FRAMES && i < rest.length; i++) keep.push(rest[Math.floor(i * step)]);
  return [...new Set(keep)].sort((a, b) => a - b);
}

function sceneAt(plan: RenderPlan, t: number): string | undefined {
  const f = t * plan.fps;
  return plan.scenes.find((s) => f >= s.start && f < s.end)?.id ?? plan.scenes[plan.scenes.length - 1]?.id;
}

/** A Wonder finding that repeats a measured one adds nothing - the measured one is exact and re-checkable. */
function duplicates(w: WonderFinding, m: MeasuredFinding): boolean {
  if (w.kind !== m.kind || Math.abs(w.time - m.time) > 1.5) return false;
  const a = (w.target ?? "").toLowerCase();
  const b = (m.target ?? "").toLowerCase();
  return w.sceneId === m.sceneId || (!!a && !!b && (a.includes(b) || b.includes(a)));
}

/** Takes the revised versions of the flagged scenes only; every other scene stays exactly as it was. */
function mergeScenes(original: unknown, revised: unknown, flagged: Set<string>): unknown {
  const orig = original as { scenes?: { id: string }[] };
  const rev = revised as { scenes?: { id: string }[] };
  if (!Array.isArray(orig?.scenes) || !Array.isArray(rev?.scenes)) throw new Error("revised plan has no scenes");
  const revById = new Map(rev.scenes.map((s) => [s.id, s]));
  const origIds = new Set(orig.scenes.map((s) => s.id));
  const scenes: unknown[] = [];
  for (const s of orig.scenes) {
    if (!flagged.has(s.id)) scenes.push(s);
    else if (revById.has(s.id)) scenes.push(revById.get(s.id));
  }
  // Scenes Spark split out of a flagged one.
  for (const s of rev.scenes) if (!origIds.has(s.id)) scenes.push(s);
  return { ...orig, scenes };
}

function summarize(findings: ReviewFinding[], ran: { wonder: boolean; masks: boolean }): SelfReview["checks"] {
  const pass: Record<CheckKind, string> = {
    relevance: ran.wonder ? "Every scene matches what's being said" : "Not checked - Muse Wonder was unavailable",
    timing: "Everything lands on its word",
    overlap: ran.masks ? "Nothing hides behind the speaker" : "No speaker masks to check against",
  };
  const out = {} as NonNullable<SelfReview["checks"]>;
  for (const kind of CHECK_KINDS) {
    const all = findings.filter((f) => f.kind === kind && f.status !== "minor");
    const open = all.filter((f) => f.status === "remaining" || f.status === "found" || f.status === "unverified").length;
    const minor = findings.filter((f) => f.kind === kind && f.status === "minor").length;
    out[kind] = {
      found: all.length,
      open,
      note:
        all.length === 0
          ? minor
            ? `${pass[kind]} (${minor} minor note${minor > 1 ? "s" : ""})`
            : pass[kind]
          : open === 0
            ? `${all.length} found · all fixed`
            : `${all.length} found · ${all.length - open} fixed`,
    };
  }
  return out;
}

export async function runSelfReview(deps: SelfReviewDeps): Promise<SelfReviewResult> {
  const { dir, transcript, renderPlan, outputPath } = deps;
  const reviewDir = path.join(dir, "review");
  await fs.mkdir(reviewDir, { recursive: true });

  const review: SelfReview = { phase: "watching", framesSampled: 0, findings: [], log: [], replannedScenes: [], hasBefore: false };
  let stage: "reviewing" | "correcting" = "reviewing";
  const publish = () => deps.publish(structuredClone(review), stage);
  const log = (text: string) => {
    review.log.push({ at: Date.now(), text });
    publish();
  };

  // --- 1. WATCH ---------------------------------------------------------------
  log("Measuring every drawing against the word that cues it");
  const masks = deps.maskSamples?.length ? await loadMasks(deps.maskSamples, renderPlan.width, renderPlan.height) : [];
  const measured = [...measureTiming(renderPlan), ...measureOverlap(renderPlan, masks)];

  const times = pickSampleTimes(renderPlan, measured.map((m) => m.time));
  const before: ReviewFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    before.push({ time: times[i], jpegBase64: await grabFrame(outputPath, times[i], path.join(reviewDir, `before-${i}.jpg`)) });
    review.framesSampled = i + 1;
    if (i % 3 === 2 || i === times.length - 1) publish();
  }
  log(`Muse Wonder is watching ${times.length} frames of your cut`);

  let wonder: WonderFinding[] = [];
  let wonderRan = false;
  try {
    wonder = await reviewWithWonder(transcript, renderPlan, before);
    wonderRan = true;
  } catch (err) {
    console.error("Muse Wonder review failed - continuing with measured checks only:", err);
    log("Muse Wonder didn't answer - continuing with the measured checks");
  }

  const sceneIds = new Set(renderPlan.scenes.map((s) => s.id));
  const nearestFrame = (t: number) => {
    let best = 0;
    times.forEach((ft, i) => {
      if (Math.abs(ft - t) < Math.abs(times[best] - t)) best = i;
    });
    return best;
  };
  const merged: Omit<ReviewFinding, "id" | "status">[] = [
    ...measured,
    ...wonder
      .filter((w) => !measured.some((m) => duplicates(w, m)))
      .map((w) => ({ ...w, source: "wonder" as const, sceneId: w.sceneId && sceneIds.has(w.sceneId) ? w.sceneId : sceneAt(renderPlan, w.time) })),
  ].sort((a, b) => a.time - b.time);
  review.findings = merged.map((f, i) => ({
    ...f,
    id: `f${i + 1}`,
    status: f.severity === "low" ? "minor" : "found",
    beforeFrame: times.length ? `before-${nearestFrame(f.time)}.jpg` : undefined,
  }));

  const actionable = review.findings.filter((f) => f.status === "found");
  const minor = review.findings.length - actionable.length;
  if (actionable.length === 0) {
    review.phase = "done";
    review.checks = summarize(review.findings, { wonder: wonderRan, masks: masks.length > 0 });
    log(minor ? `Looks good - ${minor} minor note${minor > 1 ? "s" : ""}, nothing worth re-rendering` : "Looks good - nothing to fix");
    return { review, rawPlan: deps.rawPlan, renderPlan };
  }
  log(`Found ${actionable.length} issue${actionable.length > 1 ? "s" : ""} worth fixing`);

  // --- 2. FIX -----------------------------------------------------------------
  stage = "correcting";
  review.phase = "fixing";
  for (const f of actionable) f.status = "fixing";
  const flagged = new Set(actionable.map((f) => f.sceneId).filter((s): s is string => !!s));
  review.replannedScenes = [...flagged];
  log(`Muse Spark is re-planning ${flagged.size === 1 ? "scene" : "scenes"} ${[...flagged].join(", ")}`);

  const giveUp = (why: string) => {
    for (const f of actionable) {
      f.status = "remaining";
      f.resolution = why;
    }
    review.phase = "done";
    review.checks = summarize(review.findings, { wonder: wonderRan, masks: masks.length > 0 });
    log(why);
    return { review, rawPlan: deps.rawPlan, renderPlan };
  };

  // Spark drafts a fix; each draft is laid out and measured (no render - milliseconds) and, if it
  // still has timing/overlap problems in the flagged scenes, goes back to Spark once more.
  // The best-scoring draft is the one that gets rendered.
  const draftProblems = (raw: unknown) => {
    const rp = deps.simulate(raw);
    return [...measureTiming(rp), ...measureOverlap(rp, masks)].filter((m) => m.severity !== "low" && m.sceneId && flagged.has(m.sceneId));
  };
  let revised: unknown;
  let revisedScore = Infinity;
  let request = actionable as { id: string; kind: string; sceneId?: string; target?: string; time: number; title: string; detail: string; suggestion?: string }[];
  let base: unknown = deps.rawPlan;
  for (let draft = 1; draft <= 2; draft++) {
    let candidate: unknown;
    let problems: MeasuredFinding[];
    try {
      candidate = mergeScenes(deps.rawPlan, await replanScenes(transcript, deps.space, base, request), flagged);
      problems = draftProblems(candidate);
    } catch (err) {
      console.error(`Muse Spark draft ${draft} failed:`, err);
      if (draft === 1) return giveUp("Muse Spark couldn't produce a valid fix - kept the original cut");
      break;
    }
    if (problems.length < revisedScore) {
      revised = candidate;
      revisedScore = problems.length;
    }
    if (problems.length === 0 || draft === 2) break;
    log(`Spark's draft still has ${problems.length} timing/overlap problem${problems.length > 1 ? "s" : ""} - asking for another pass`);
    base = candidate;
    request = problems.map((m, i) => ({ ...m, id: `d${i + 1}` }));
  }

  // --- 3. RENDER --------------------------------------------------------------
  await fs.copyFile(outputPath, path.join(dir, "output-before.mp4"));
  review.hasBefore = true;
  review.phase = "rerendering";
  log("Re-drawing and compositing the fixed scenes");
  let after: { renderPlan: RenderPlan; rawPlan: unknown };
  try {
    after = await deps.rerender(revised);
  } catch (err) {
    console.error("Re-render after fix failed:", err);
    await fs.copyFile(path.join(dir, "output-before.mp4"), outputPath).catch(() => {});
    review.hasBefore = false;
    return giveUp("The fixed plan couldn't be rendered - kept the original cut");
  }

  // --- 4. VERIFY --------------------------------------------------------------
  review.phase = "verifying";
  log("Checking the fixes on the new cut");
  const afterMeasured = [...measureTiming(after.renderPlan), ...measureOverlap(after.renderPlan, masks)];
  for (const f of actionable.filter((x) => x.source === "measured")) {
    const still = afterMeasured.find((m) => m.kind === f.kind && m.elementId === f.elementId);
    if (still) {
      f.status = "remaining";
      f.resolution = still.title;
    } else {
      f.status = "fixed";
      f.resolution =
        (f.kind === "timing" ? describeTimingNow(after.renderPlan, f.elementId ?? "") : describeOverlapNow(after.renderPlan, masks, f.elementId ?? "")) ??
        (f.target ? `Muse Spark reworked the scene - “${f.target}” is no longer drawn there` : "Muse Spark reworked the scene");
    }
  }

  const afterFrames: ReviewFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    afterFrames.push({ time: times[i], jpegBase64: await grabFrame(outputPath, times[i], path.join(reviewDir, `after-${i}.jpg`)) });
  }
  for (const f of review.findings) if (f.beforeFrame) f.afterFrame = f.beforeFrame.replace("before-", "after-");

  const fromWonder = actionable.filter((x) => x.source === "wonder");
  if (fromWonder.length > 0) {
    try {
      log(`Muse Wonder is taking a second look at ${fromWonder.length} finding${fromWonder.length > 1 ? "s" : ""}`);
      const verdicts = await verifyWithWonder(transcript, after.renderPlan, fromWonder, afterFrames);
      for (const f of fromWonder) {
        const v = verdicts.find((x) => x.id === f.id);
        f.status = v ? (v.fixed ? "fixed" : "remaining") : "unverified";
        f.resolution = v?.note ?? "Re-planned - Wonder didn't rule on it";
      }
    } catch (err) {
      console.error("Muse Wonder verification failed:", err);
      for (const f of fromWonder) {
        f.status = "unverified";
        f.resolution = "Re-planned - couldn't re-check it";
      }
    }
  }

  // Anything the fix itself broke is reported honestly, not hidden.
  const known = new Set(actionable.filter((f) => f.elementId).map((f) => `${f.kind}:${f.elementId}`));
  let n = review.findings.length;
  for (const m of afterMeasured) {
    if (m.severity === "low" || known.has(`${m.kind}:${m.elementId}`) || !m.sceneId || !flagged.has(m.sceneId)) continue;
    review.findings.push({ ...m, id: `f${++n}`, status: "remaining", resolution: "New after the fix" });
  }

  const fixed = actionable.filter((f) => f.status === "fixed").length;
  review.phase = "done";
  review.checks = summarize(review.findings, { wonder: wonderRan, masks: masks.length > 0 });
  log(`Done - ${fixed} of ${actionable.length} fixed. Compare before and after on the result screen`);
  return { review, rawPlan: after.rawPlan, renderPlan: after.renderPlan };
}
