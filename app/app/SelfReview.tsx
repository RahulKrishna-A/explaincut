"use client";

import { CHECK_KINDS, CHECK_LABELS, type FindingStatus, type ReviewFinding, type ReviewPhase, type SelfReview } from "@/types/review";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

const LOOP: { key: string; label: string; model: string; phases: ReviewPhase[] }[] = [
  { key: "watch", label: "Watch", model: "Muse Wonder", phases: ["watching"] },
  { key: "fix", label: "Re-plan", model: "Muse Spark", phases: ["fixing"] },
  { key: "render", label: "Re-render", model: "Remotion", phases: ["rerendering"] },
  { key: "verify", label: "Verify", model: "Wonder + checks", phases: ["verifying"] },
];

function loopState(phase: ReviewPhase | undefined, i: number, skippedFix: boolean): "todo" | "current" | "done" | "skipped" {
  if (!phase) return "todo";
  const at = LOOP.findIndex((s) => s.phases.includes(phase));
  if (phase === "done" || phase === "failed") return skippedFix && i > 0 ? "skipped" : "done";
  if (i < at) return "done";
  return i === at ? "current" : "todo";
}

/** The four steps of the loop, as a row of chips. */
function LoopSteps({ phase, skippedFix }: { phase?: ReviewPhase; skippedFix?: boolean }) {
  return (
    <ol className="ec-loop" aria-label="Self-review steps">
      {LOOP.map((s, i) => (
        <li key={s.key} data-state={loopState(phase, i, !!skippedFix)}>
          <span className="ec-loop-n">{loopState(phase, i, !!skippedFix) === "done" ? "✓" : i + 1}</span>
          <span>
            <span style={{ fontWeight: 600 }}>{s.label}</span>
            <span className="ec-loop-model">{s.model}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Upload screen
// ---------------------------------------------------------------------------

export function SelfReviewToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ec-panel ec-settings">
      <div className="ec-settings-head">
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Self-review</div>
          <div style={{ fontSize: 13, color: "var(--muted-2)" }}>
            Muse Wonder watches your cut, Muse Spark fixes what it finds, and the video is re-rendered before you see it.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Self-review"
          className="ec-switch"
          disabled={disabled}
          onClick={() => onChange(!enabled)}
        >
          <span />
        </button>
      </div>
      <div data-off={!enabled} className="ec-settings-body">
        <LoopSteps />
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
          Checks relevance, timing and speaker overlap. Adds a minute or two when something needs fixing.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status chips
// ---------------------------------------------------------------------------

const STATUS: Record<FindingStatus, { label: string; tone: "warn" | "busy" | "ok" | "muted" | "danger" }> = {
  found: { label: "Found", tone: "warn" },
  fixing: { label: "Fixing…", tone: "busy" },
  fixed: { label: "Fixed", tone: "ok" },
  remaining: { label: "Still there", tone: "danger" },
  unverified: { label: "Re-planned", tone: "muted" },
  minor: { label: "Minor", tone: "muted" },
};

function StatusChip({ status }: { status: FindingStatus }) {
  const s = STATUS[status];
  return (
    <span className="ec-status" data-tone={s.tone}>
      {status === "fixed" ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
      {s.label}
    </span>
  );
}

function KindTag({ finding }: { finding: ReviewFinding }) {
  return (
    <span className="ec-kind" data-tone={finding.status === "fixed" ? "ok" : finding.status === "minor" ? "muted" : "warn"}>
      {CHECK_LABELS[finding.kind]}
    </span>
  );
}

const sourceLabel = (f: ReviewFinding) => (f.source === "wonder" ? "Muse Wonder" : f.kind === "overlap" ? "SAM 3.1 masks" : "Measured");

// ---------------------------------------------------------------------------
// Generating screen: the loop, live
// ---------------------------------------------------------------------------

export function ReviewLive({ jobId, review }: { jobId: string; review: SelfReview }) {
  const watching = review.phase === "watching";
  const shown = review.findings.filter((f) => f.status !== "minor");
  const minor = review.findings.length - shown.length;
  const last = review.log[review.log.length - 1];

  return (
    <div className="ec-card ec-review-live" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Self-review</span>
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
          {review.framesSampled} frame{review.framesSampled === 1 ? "" : "s"} sampled
        </span>
      </div>
      <LoopSteps phase={review.phase} skippedFix={review.phase === "done" && shown.length === 0} />

      {review.framesSampled > 0 ? (
        <div className="ec-frames" aria-label="Frames Muse Wonder is watching">
          {Array.from({ length: review.framesSampled }, (_, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={`/api/frame/${jobId}/before-${i}.jpg`}
              alt=""
              data-scanning={watching && i === review.framesSampled - 1}
            />
          ))}
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul className="ec-live-findings">
          {shown.map((f) => (
            <li key={f.id} data-status={f.status}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <KindTag finding={f} />
                <span className="ec-live-title">{f.title}</span>
              </div>
              <StatusChip status={f.status} />
              {f.resolution && (f.status === "fixed" || f.status === "remaining") ? (
                <span className="ec-live-resolution">→ {f.resolution}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {minor > 0 && review.phase !== "watching" ? (
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
          + {minor} minor note{minor > 1 ? "s" : ""}, not worth a re-render
        </span>
      ) : null}

      {last ? (
        <div className="ec-live-log" aria-live="polite">
          <span className="ec-live-dot" />
          {last.text}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result screen: the report (v3 screen 05)
// ---------------------------------------------------------------------------

/** One-line summary for the result panel, e.g. "2 fixed". */
export function reviewSummary(review: SelfReview | undefined, enabled: boolean): string {
  if (!enabled) return "Off";
  if (!review) return "—";
  if (review.phase === "failed") return "Couldn't run";
  const real = review.findings.filter((f) => f.status !== "minor");
  if (real.length === 0) return "Pass";
  const fixed = real.filter((f) => f.status === "fixed").length;
  return fixed === real.length ? `${fixed} fixed` : `${fixed} of ${real.length} fixed`;
}

export function ReviewReport({
  jobId,
  review,
  onJump,
}: {
  jobId: string;
  review: SelfReview;
  onJump: (time: number) => void;
}) {
  if (review.phase === "failed") {
    return (
      <section className="ec-review">
        <div className="ec-note" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
          The self-review couldn&apos;t finish ({review.error ?? "unknown error"}). This is the first cut, unreviewed.
        </div>
      </section>
    );
  }
  const checks = review.checks;
  const wonderCount = review.findings.filter((f) => f.source === "wonder").length;
  const fixedCount = review.findings.filter((f) => f.status === "fixed").length;

  return (
    <section className="ec-review" aria-label="Self-review report">
      <div className="ec-review-head">
        <h2>Self-review</h2>
        <span>
          Muse Wonder · {review.framesSampled} sampled frames
          {review.replannedScenes.length > 0
            ? ` · Muse Spark re-planned ${review.replannedScenes.length === 1 ? "1 scene" : `${review.replannedScenes.length} scenes`}`
            : ""}
          {fixedCount > 0 ? ` · ${fixedCount} fixed automatically` : ""}
        </span>
      </div>

      {checks ? (
        <div className="ec-checks">
          {CHECK_KINDS.map((kind) => {
            const c = checks[kind];
            const open = c.open > 0;
            const fixed = c.found > 0 && !open;
            return (
              <div key={kind} className="ec-panel ec-check">
                <span className="ec-check-head">
                  {CHECK_LABELS[kind]}
                  <span className="ec-check-icon" data-tone={open ? "warn" : "ok"}>
                    {open ? (
                      "!"
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </span>
                <span className="ec-check-value" data-tone={open ? "warn" : "ok"}>
                  {open ? `${c.open} open` : fixed ? "Fixed" : "Pass"}
                </span>
                <span className="ec-check-note">{c.note}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="ec-panel ec-findings">
        <div className="ec-review-head" style={{ marginBottom: 4 }}>
          <h3>Findings</h3>
          <span>
            {review.findings.length === 0
              ? "Nothing to report"
              : `${review.findings.length} total · ${wonderCount} from Muse Wonder, ${review.findings.length - wonderCount} measured`}
          </span>
        </div>
        {review.findings.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
            Muse Wonder and the measured checks found nothing worth fixing in this cut.
          </p>
        ) : (
          review.findings.map((f) => (
            <div key={f.id} className="ec-finding" data-status={f.status}>
              <div className="ec-finding-frames">
                {f.beforeFrame ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/frame/${jobId}/${f.beforeFrame}`} alt={`Frame at ${fmtTime(f.time)} before the fix`} />
                    <figcaption>{f.afterFrame ? "Before" : `frame ${fmtTime(f.time)}`}</figcaption>
                  </figure>
                ) : null}
                {f.afterFrame && review.hasBefore ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/frame/${jobId}/${f.afterFrame}`} alt={`Frame at ${fmtTime(f.time)} after the fix`} />
                    <figcaption>After</figcaption>
                  </figure>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <KindTag finding={f} />
                  <span className="ec-finding-meta">
                    {fmtTime(f.time)} · {sourceLabel(f)}
                  </span>
                  <StatusChip status={f.status} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{f.title}</span>
                {f.detail ? <span style={{ fontSize: 13, color: "var(--muted)" }}>{f.detail}</span> : null}
                {f.resolution ? (
                  <span className="ec-finding-resolution" data-status={f.status}>
                    → {f.resolution}
                  </span>
                ) : null}
              </div>
              <button className="ec-btn" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => onJump(f.time)}>
                Jump to
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
