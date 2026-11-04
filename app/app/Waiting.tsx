"use client";

import { useEffect, useState } from "react";
import type { JobStage } from "@/types/job";
import "./waiting.css";
import { CutoutScene, PlanScene, RenderScene, ReviewScene, TranscribeScene } from "./WaitingScenes";

type Group = {
  name: string;
  stages: JobStage[];
  /** Rough expected seconds, used only to ease the progress bar and estimate time left. */
  seconds: number;
  title: string;
  model: string;
  headline: string;
  sub: string;
  Scene: () => React.JSX.Element;
};

const BASE_GROUPS: Group[] = [
  { name: "Transcribe", stages: ["uploaded", "transcribing"], seconds: 25, title: "Transcribing", model: "Muse Voice", headline: "Listening to every word.", sub: "We’re writing down what you said and when you said it, down to the tenth of a second.", Scene: TranscribeScene },
  { name: "Cut out speaker", stages: ["segmenting"], seconds: 60, title: "Cutting you out", model: "SAM 3.1", headline: "Finding you in every frame.", sub: "We’re tracing your outline so the diagram can sit behind you.", Scene: CutoutScene },
  { name: "Plan diagram", stages: ["planning", "illustrating"], seconds: 45, title: "Planning the diagram", model: "Muse Spark · Muse Image", headline: "Sketching the diagram.", sub: "We’re turning your explanation into boxes and arrows, each timed to a word.", Scene: PlanScene },
  { name: "Render", stages: ["rendering_diagram", "compositing"], seconds: 90, title: "Rendering", model: "Remotion · FFmpeg", headline: "Putting it all together.", sub: "Background, diagram and you, layered and rendered frame by frame.", Scene: RenderScene },
];
const REVIEW_GROUP: Group = { name: "Review", stages: ["reviewing", "correcting"], seconds: 40, title: "Reviewing", model: "Muse Wonder", headline: "One last look.", sub: "We’re checking that the diagram fits what you said and never covers your face.", Scene: ReviewScene };

const TIPS = [
  "You can switch tabs while this runs. Turn on notifications and we’ll ping you when it’s ready.",
  "A short pause before each new idea gives the diagram room to land.",
  "Every box is tied to a word you said, so the diagram stays in sync with your voice.",
  "A plain background behind you gives the cleanest cutout.",
];

function formatLeft(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export function Waiting({
  stage,
  stageStartedAt,
  reviewOn,
  liveLabel,
  notify,
  onToggleNotify,
  onCancel,
}: {
  stage: JobStage | undefined;
  stageStartedAt?: number;
  reviewOn: boolean;
  liveLabel: string;
  notify: boolean;
  onToggleNotify: () => void;
  onCancel: () => void;
}) {
  const groups = reviewOn ? [...BASE_GROUPS, REVIEW_GROUP] : BASE_GROUPS;
  const [tipIdx, setTipIdx] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const a = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 6500);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const found = groups.findIndex((g) => stage && g.stages.includes(stage));
  const si = found < 0 ? 0 : found;
  const g = groups[si];
  // Ease within the current stage by time spent in it, never claiming it's finished early.
  const inStage = stageStartedAt ? Math.max(0, (now - stageStartedAt) / 1000) : 0;
  const frac = Math.min(0.92, 1 - Math.exp(-inStage / g.seconds));
  const total = groups.reduce((a, x) => a + x.seconds, 0);
  const doneSec = groups.slice(0, si).reduce((a, x) => a + x.seconds, 0) + frac * g.seconds;
  const pct = Math.min(99, Math.round((doneSec / total) * 100));
  const left = Math.max(5, total - doneSec);
  const Scene = g.Scene;

  return (
    <div className="ec-card ecw-card">
      <div className="ecw-stage">
        <Scene key={g.name} />
        <div className="ecw-chip"><span>{g.title}</span><span>{g.model}</span></div>
      </div>

      <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 700, margin: 0, textWrap: "balance" }}>{g.headline}</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--muted)", margin: 0, maxWidth: 620, textWrap: "pretty" }}>
            {g.sub} Feel free to keep working in another tab. We’ll let you know when it’s ready.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 14, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
              <span className="ecw-dot" />
              {liveLabel.replace(/[.…]+$/, "")}…
            </span>
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {pct}% · about {formatLeft(left)} left
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            style={{ display: "grid", gridTemplateColumns: groups.map((x) => `${x.seconds}fr`).join(" "), gap: 4 }}
          >
            {groups.map((x, i) => {
              const fill = i < si ? 100 : i === si ? frac * 100 : 0;
              return (
                <div key={x.name} className="ecw-seg" title={x.name}>
                  <span className="ecw-seg-track"><span className="ecw-seg-fill" style={{ width: `${fill}%` }} /></span>
                  <span className="ecw-seg-name" style={{ fontWeight: i === si ? 700 : 500, color: i === si ? "var(--ink)" : "oklch(0.58 0.01 70)" }}>{x.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ecw-tip"><b>Tip</b><span>{TIPS[tipIdx]}</span></div>

        <div className="ecw-actions">
          <button type="button" className="ecw-btn" data-on={notify} aria-pressed={notify} onClick={onToggleNotify}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {notify ? "We’ll notify you" : "Notify me when ready"}
          </button>
          <button type="button" className="ecw-btn" onClick={() => window.open("/app", "_blank")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
            Keep working in a new tab
          </button>
          <button type="button" className="ecw-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
