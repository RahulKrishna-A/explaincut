"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { JobStage, JobStatus } from "@/types/job";
import { CAPTION_FONT_LABELS, DEFAULT_RENDER_OPTIONS, type RenderOptions } from "@/types/renderOptions";
import { CaptionSettingsPanel } from "./CaptionSettingsPanel";
import { ReviewLive, ReviewReport, SelfReviewToggle, reviewSummary } from "./SelfReview";

const OPTIONS_KEY = "explaincut.renderOptions";

// Render settings are remembered per browser. A tiny external store over
// localStorage: hydration-safe (the server snapshot is "no saved settings"),
// and if storage is blocked the settings still work for this visit.
const optionListeners = new Set<() => void>();
let memoryOptions: string | null = null;
function readSavedOptions(): string | null {
  try {
    return window.localStorage.getItem(OPTIONS_KEY) ?? memoryOptions;
  } catch {
    return memoryOptions;
  }
}
function saveOptions(next: RenderOptions) {
  memoryOptions = JSON.stringify(next);
  try {
    window.localStorage.setItem(OPTIONS_KEY, memoryOptions);
  } catch {
    // private mode / blocked storage - kept in memory only
  }
  optionListeners.forEach((l) => l());
}
function subscribeOptions(listener: () => void) {
  optionListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    optionListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function parseSavedOptions(raw: string | null): RenderOptions {
  if (!raw) return DEFAULT_RENDER_OPTIONS;
  try {
    const saved = JSON.parse(raw) as Partial<RenderOptions>;
    return {
      ...DEFAULT_RENDER_OPTIONS,
      captions: { ...DEFAULT_RENDER_OPTIONS.captions, ...saved.captions },
      selfReview: { ...DEFAULT_RENDER_OPTIONS.selfReview, ...saved.selfReview },
    };
  } catch {
    return DEFAULT_RENDER_OPTIONS;
  }
}

type PipelineStep = { stage: JobStage; name: string; model: string; live: string };

// The working stages, in the order the pipeline actually runs them.
const BASE_PIPELINE: PipelineStep[] = [
  { stage: "transcribing", name: "Transcribe", model: "Muse Voice", live: "Transcribing your speech" },
  { stage: "segmenting", name: "Cut out speaker", model: "SAM 3.1", live: "Finding you in the frame" },
  { stage: "planning", name: "Plan diagram", model: "Muse Spark", live: "Planning the diagram" },
  { stage: "illustrating", name: "Stickers", model: "Muse Image", live: "Drawing stickers for the key ideas" },
  { stage: "rendering_diagram", name: "Render", model: "Remotion", live: "Rendering the diagram animation" },
  { stage: "compositing", name: "Composite", model: "FFmpeg", live: "Compositing the final video" },
];

// The self-correcting loop, when it's switched on.
const REVIEW_STEPS: PipelineStep[] = [
  { stage: "reviewing", name: "Review", model: "Muse Wonder", live: "Muse Wonder is reviewing your cut" },
  { stage: "correcting", name: "Fix", model: "Muse Spark", live: "Fixing what the review found" },
];

function pipelineFor(selfReview: boolean): PipelineStep[] {
  return selfReview ? [...BASE_PIPELINE, ...REVIEW_STEPS] : BASE_PIPELINE;
}

function stageNumber(stage: JobStage | undefined, pipeline: PipelineStep[]): number {
  if (!stage || stage === "uploaded") return 0;
  if (stage === "done") return pipeline.length;
  const i = pipeline.findIndex((p) => p.stage === stage);
  return i === -1 ? 0 : i + 1;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Phase = "upload" | "generate" | "result";

function Header({ phase }: { phase: Phase }) {
  const labels: { key: Phase; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "generate", label: "Generate" },
    { key: "result", label: "Result" },
  ];
  const current = labels.findIndex((l) => l.key === phase);
  return (
    <header className="ec-header">
      <Link href="/" className="ec-brand" style={{ color: "inherit", textDecoration: "none" }}>
        <span className="ec-brand-mark" />
        ExplainCut
      </Link>
      <nav className="ec-steps" aria-label="Progress">
        {labels.map((l, i) => (
          <span
            key={l.key}
            className="ec-step"
            data-state={i < current ? "done" : i === current ? "current" : "todo"}
            aria-current={i === current ? "step" : undefined}
          >
            <span>{i < current ? "✓" : i + 1}</span>
            <span className="ec-step-label">{l.label}</span>
          </span>
        ))}
      </nav>
      <div className="ec-header-spacer" />
    </header>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [outputMeta, setOutputMeta] = useState<{ duration: number; width: number; height: number } | null>(null);
  const savedOptions = useSyncExternalStore(subscribeOptions, readSavedOptions, () => null);
  const options = useMemo(() => parseSavedOptions(savedOptions), [savedOptions]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Result screen: which cut is playing (the fixed one, or the first cut before the self-review).
  const [variant, setVariant] = useState<"after" | "before">("after");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef<{ time: number; play: boolean } | null>(null);
  const startedAtRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // Local preview of the chosen clip (thumbnail while generating).
  const previewRef = useRef<string | null>(null);
  const setPreview = useCallback((f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = f ? URL.createObjectURL(f) : null;
    setPreviewUrl(previewRef.current);
  }, []);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  // Elapsed clock while the job is running.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const pollStatus = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/status/${id}`);
        if (!res.ok) return;
        const status = (await res.json()) as JobStatus;
        setJob(status);
        if (status.stage === "done" || status.stage === "error") {
          stopPolling();
          setBusy(false);
          setElapsed((Date.now() - startedAtRef.current) / 1000);
        }
      }, 1500);
    },
    [stopPolling]
  );

  const handleGenerate = useCallback(
    async (chosen: File) => {
      setBusy(true);
      setErrorMessage(null);
      setJob(null);
      setOutputMeta(null);
      setVariant("after");
      setElapsed(0);
      startedAtRef.current = Date.now();

      try {
        const form = new FormData();
        form.append("video", chosen);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { jobId: newJobId } = (await uploadRes.json()) as { jobId: string };
        setJobId(newJobId);

        const renderRes = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: newJobId, options }),
        });
        if (!renderRes.ok) throw new Error("Failed to start processing");

        pollStatus(newJobId);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [pollStatus, options]
  );

  // Picking a clip starts the job right away, as the design's upload screen has no separate Generate step.
  const choose = useCallback(
    (f: File | null | undefined) => {
      if (!f || busy) return;
      if (!f.type.startsWith("video/")) {
        setErrorMessage("Please choose a video file.");
        return;
      }
      setFile(f);
      setPreview(f);
      void handleGenerate(f);
    },
    [busy, handleGenerate, setPreview]
  );

  const startOver = useCallback(() => {
    stopPolling();
    setFile(null);
    setPreview(null);
    setJob(null);
    setJobId(null);
    setBusy(false);
    setErrorMessage(null);
    setOutputMeta(null);
    setVariant("after");
    setElapsed(0);
    if (inputRef.current) inputRef.current.value = "";
  }, [stopPolling, setPreview]);

  const failed = job?.stage === "error" || (!!errorMessage && !!file);
  const done = job?.stage === "done" && !!jobId;
  const phase: Phase = done ? "result" : busy || failed || job ? "generate" : "upload";

  const reviewOn = (job?.options ?? options).selfReview.enabled;
  const PIPELINE = pipelineFor(reviewOn);
  const n = stageNumber(job?.stage, PIPELINE);
  const active = n > 0 ? PIPELINE[Math.min(n, PIPELINE.length) - 1] : null;
  const reviewing = job?.stage === "reviewing" || job?.stage === "correcting";
  const lastReviewLog = job?.selfReview?.log[job.selfReview.log.length - 1]?.text;
  const liveLabel = reviewing && lastReviewLog ? lastReviewLog : active ? active.live : "Uploading your clip";

  /** Switch between the fixed cut and the first cut, keeping the playhead where it was. */
  const showVariant = (next: "after" | "before", time?: number, play = false) => {
    const v = videoRef.current;
    const t = time ?? v?.currentTime ?? 0;
    if (next === variant && v) {
      v.currentTime = t;
      if (play) void v.play();
      return;
    }
    pendingSeekRef.current = { time: t, play: play || (!!v && !v.paused) };
    setVariant(next);
  };

  return (
    <div className="ec-app">
      <div className="ec-glow" />
      <Header phase={phase} />

      {phase === "upload" ? (
        <main className="ec-main" style={{ gap: 28 }}>
          <div className="ec-hero">
            <h1>Upload your explanation</h1>
            <p>We’ll draw the diagram behind you, in sync with your words.</p>
          </div>

          <div className="ec-card" style={{ maxWidth: 720 }}>
            <div
              className="ec-drop"
              data-over={dragOver}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                choose(e.dataTransfer.files?.[0]);
              }}
            >
              <span className="ec-drop-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="oklch(0.5 0.16 45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15V3" />
                  <path d="m7 8 5-5 5 5" />
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                </svg>
              </span>
              <span style={{ fontWeight: 600, fontSize: 20 }}>Drop a talking-head video</span>
              <span style={{ fontSize: 14, color: "var(--muted-2)" }}>
                Webcam framing and a plain background work best.
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => choose(e.target.files?.[0])}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="ec-btn ec-btn-dark" onClick={() => inputRef.current?.click()}>
                  Choose file
                </button>
              </div>
              {errorMessage ? (
                <p style={{ color: "var(--danger)", fontSize: 14, margin: "8px 0 0" }}>{errorMessage}</p>
              ) : null}
            </div>
          </div>

          <CaptionSettingsPanel
            value={options.captions}
            onChange={(captions) => saveOptions({ ...options, captions })}
            disabled={busy}
          />

          <SelfReviewToggle
            enabled={options.selfReview.enabled}
            onChange={(enabled) => saveOptions({ ...options, selfReview: { enabled } })}
            disabled={busy}
          />

          <div className="ec-pipeline">
            {PIPELINE.map((p, i) => (
              <span key={p.stage} className="ec-chip">
                <span className="ec-chip-n">{i + 1}</span>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: "var(--muted-2)" }}>{p.model}</span>
              </span>
            ))}
          </div>
        </main>
      ) : null}

      {phase === "generate" ? (
        <main className="ec-main" style={{ gap: 16 }}>
          <div className="ec-card" style={{ maxWidth: 640 }}>
            <div className="ec-file-row">
              {previewUrl ? (
                <video className="ec-thumb" src={previewUrl} muted preload="metadata" />
              ) : (
                <div className="ec-thumb" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file?.name ?? "Your clip"}
                </div>
                {file ? <div style={{ fontSize: 13, color: "var(--muted-2)" }}>{formatBytes(file.size)}</div> : null}
              </div>
            </div>

            {failed ? (
              <div className="ec-progress-well">
                <span
                  className="ec-badge"
                  style={{ background: "var(--danger-soft)", color: "var(--danger)", marginBottom: 0 }}
                >
                  Failed
                </span>
                <h2 style={{ fontSize: 26, letterSpacing: "-0.03em", margin: 0 }}>Something went wrong</h2>
                <p style={{ margin: 0, fontSize: 14, color: "var(--muted)", wordBreak: "break-word" }}>
                  {job?.error ?? errorMessage}
                </p>
                <div>
                  <button className="ec-btn ec-btn-dark" onClick={startOver}>
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="ec-progress-well">
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                  <div className="ec-big">
                    {n}
                    <span style={{ color: "var(--accent)" }}>/{PIPELINE.length}</span>
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontSize: 13,
                      color: "var(--muted-2)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    Elapsed {formatClock(elapsed)}
                  </div>
                </div>
                <div className="ec-bar" role="progressbar" aria-valuemin={0} aria-valuemax={PIPELINE.length} aria-valuenow={n}>
                  {PIPELINE.map((p, i) => (
                    <span
                      key={p.stage}
                      data-state={i < n - 1 ? "done" : i === n - 1 ? "current" : "todo"}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 14 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <span className="ec-live-dot" />
                    {liveLabel.replace(/[.…]+$/, "")}…
                  </span>
                  <span style={{ color: "var(--muted-2)", whiteSpace: "nowrap" }}>
                    Step {Math.max(n, 1)} of {PIPELINE.length}
                  </span>
                </div>
              </div>
            )}
          </div>
          {!failed && jobId && job?.selfReview ? <ReviewLive jobId={jobId} review={job.selfReview} /> : null}
        </main>
      ) : null}

      {phase === "result" && jobId ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="ec-result">
            <div className="ec-card" style={{ alignSelf: "start", display: "flex", flexDirection: "column", gap: 10 }}>
              {job?.selfReview?.hasBefore ? (
                <div className="ec-variant">
                  <div className="ec-seg" role="radiogroup" aria-label="Which cut to play">
                    <button type="button" role="radio" aria-checked={variant === "after"} data-on={variant === "after"} onClick={() => showVariant("after")}>
                      After self-review
                    </button>
                    <button type="button" role="radio" aria-checked={variant === "before"} data-on={variant === "before"} onClick={() => showVariant("before")}>
                      Before
                    </button>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--muted-2)" }}>
                    {variant === "before" ? "The first cut, before Muse Spark fixed it" : "Fixed by the self-review"}
                  </span>
                </div>
              ) : null}
              <video
                ref={videoRef}
                className="ec-video"
                controls
                src={`/api/download/${jobId}${variant === "before" ? "?variant=before" : ""}`}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setOutputMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
                  const seek = pendingSeekRef.current;
                  pendingSeekRef.current = null;
                  if (seek) {
                    v.currentTime = Math.min(seek.time, v.duration || seek.time);
                    if (seek.play) void v.play();
                  }
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="ec-panel" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="ec-badge" style={{ color: "var(--ok)", background: "var(--ok-soft)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Ready
                </span>
                <h2 style={{ fontSize: 26, letterSpacing: "-0.03em", margin: 0 }}>Your cut is ready</h2>
                {file ? (
                  <span style={{ fontSize: 13, color: "var(--muted-2)", wordBreak: "break-all" }}>{file.name}</span>
                ) : null}
              </div>

              <div className="ec-panel" style={{ padding: "6px 22px" }}>
                <div className="ec-row">
                  <span>Duration</span>
                  <span>{outputMeta ? formatClock(outputMeta.duration) : "—"}</span>
                </div>
                <div className="ec-row">
                  <span>Resolution</span>
                  <span>{outputMeta ? `${outputMeta.width}×${outputMeta.height}` : "—"}</span>
                </div>
                <div className="ec-row">
                  <span>Captions</span>
                  <span>
                    {(job?.options ?? options).captions.enabled
                      ? CAPTION_FONT_LABELS[(job?.options ?? options).captions.font]
                      : "Off"}
                  </span>
                </div>
                <div className="ec-row">
                  <span>Self-review</span>
                  <span>{reviewSummary(job?.selfReview, reviewOn)}</span>
                </div>
                <div className="ec-row">
                  <span>Processing time</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatClock(elapsed)}</span>
                </div>
              </div>

              {job?.message ? (
                <div className="ec-note" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                  {job.message}
                </div>
              ) : null}

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                <a className="ec-btn ec-btn-accent" href={`/api/download/${jobId}?download=1`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12m-5-5 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  Download MP4
                </a>
                <button className="ec-btn ec-btn-ghost" onClick={startOver}>
                  Start over
                </button>
              </div>
            </div>
          </div>
          {job?.selfReview ? (
            <ReviewReport
              jobId={jobId}
              review={job.selfReview}
              onJump={(time) => {
                showVariant("after", Math.max(0, time - 0.6), true);
                videoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
