"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobStatus } from "@/types/job";

const STAGE_LABEL: Record<JobStatus["stage"], string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing speech…",
  planning: "Planning the diagram…",
  rendering_diagram: "Rendering the diagram animation…",
  segmenting: "Finding you in the frame…",
  compositing: "Compositing the final video…",
  reviewing: "Reviewing the result…",
  done: "Done",
  error: "Failed",
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

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
        }
      }, 1500);
    },
    [stopPolling]
  );

  const handleGenerate = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setErrorMessage(null);
    setJob(null);

    try {
      const form = new FormData();
      form.append("video", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { jobId: newJobId } = (await uploadRes.json()) as { jobId: string };
      setJobId(newJobId);

      const renderRes = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: newJobId }),
      });
      if (!renderRes.ok) throw new Error("Failed to start processing");

      pollStatus(newJobId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [file, pollStatus]);

  const stageLabel = job ? STAGE_LABEL[job.stage] : null;

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>ExplainCut</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Upload a talking-head clip. Diagrams build themselves in sync with what you say.
      </p>

      <input
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={busy}
      />

      <div style={{ marginTop: 16 }}>
        <button
          onClick={handleGenerate}
          disabled={!file || busy}
          style={{
            padding: "10px 20px",
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 8,
            border: "none",
            background: !file || busy ? "#ccc" : "#4f7cff",
            color: "white",
            cursor: !file || busy ? "default" : "pointer",
          }}
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>

      {errorMessage ? (
        <p style={{ color: "#c0392b", marginTop: 16 }}>Error: {errorMessage}</p>
      ) : null}

      {job ? (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontWeight: 600 }}>{stageLabel}</p>
          {job.error ? <p style={{ color: "#c0392b" }}>{job.error}</p> : null}
          {job.message ? <p style={{ color: "#8a6d00" }}>{job.message}</p> : null}
          {job.reviewIssues && job.reviewIssues.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontWeight: 600 }}>Wonder review notes:</p>
              <ul>
                {job.reviewIssues.map((issue, i) => (
                  <li key={i}>
                    [{issue.severity}] {issue.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {job?.stage === "done" && jobId ? (
        <div style={{ marginTop: 24 }}>
          <video controls style={{ width: "100%", borderRadius: 8 }} src={`/api/download/${jobId}`} />
          <p style={{ marginTop: 8 }}>
            <a href={`/api/download/${jobId}?download=1`}>Download the MP4</a>
          </p>
        </div>
      ) : null}
    </main>
  );
}
