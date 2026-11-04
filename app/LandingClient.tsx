"use client";

import { useState } from "react";

const FAQ: [string, string][] = [
  ["What kind of video works best?", "A single webcam take with a plain background. No screen share or slides."],
  ["Are the diagrams AI-generated images?", "No. Muse Spark writes a structured plan of nodes, arrows and marks. Remotion draws it in code as hand-drawn sketches, so every label matches what you said."],
  ["Which diagram types are supported?", "Five scene layouts: flow, hub, stack, cycle and compare. A video can use more than one."],
  ["Where does it run?", "Locally on your machine. Your footage is sent only to the model APIs that process it."],
  ["Does it review the result?", "Optionally. When the review pass is enabled, Muse Wonder checks sampled frames and lists problems with a severity. It reports only; it does not fix them."],
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {FAQ.map(([q, a], i) => (
        <div key={q} className="lp-faq">
          <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            <span>{q}</span>
            <i>{open === i ? "−" : "+"}</i>
          </button>
          {open === i ? <p>{a}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function DemoTabs() {
  const [tab, setTab] = useState(0);
  const tabs = ["Upload", "Result"];
  return (
    <>
      <div className="lp-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t} role="tab" aria-selected={tab === i} className="lp-tab" onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ width: "100%", maxWidth: 900, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: 10, boxShadow: "0 40px 80px -32px rgba(40,28,18,.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px 12px" }}>
          {[0, 1, 2].map((d) => (
            <span key={d} style={{ width: 10, height: 10, borderRadius: 99, background: "oklch(0.88 0.01 70)" }} />
          ))}
          <span style={{ margin: "0 auto", fontSize: 12, color: "var(--muted-2)", background: "oklch(0.97 0.004 70)", padding: "4px 14px", borderRadius: 6 }}>
            localhost:3000/app
          </span>
        </div>
        <div style={{ borderRadius: 6, background: "var(--well)", padding: 24, minHeight: 380 }}>
          {tab === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ border: "2px dashed oklch(0.88 0.01 70)", borderRadius: 6, background: "#fff", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                <span style={{ width: 48, height: 48, borderRadius: 8, background: "var(--accent-soft)", display: "grid", placeItems: "center", marginBottom: 6 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="oklch(0.5 0.16 45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  </svg>
                </span>
                <span style={{ fontWeight: 600, fontSize: 19 }}>Drop a talking-head video</span>
                <span style={{ fontSize: 14, color: "var(--muted-2)" }}>Webcam framing and a plain background work best</span>
              </div>
              <div style={{ background: "#fff", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>Finding you in the frame…</span>
                  <span style={{ color: "var(--muted)" }}>Step 2 of 5</span>
                </div>
                <div className="ec-bar" style={{ height: 8 }}>
                  {["done", "current", "todo", "todo", "todo"].map((s, i) => <span key={i} data-state={s} />)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="lp-stage">
                <div className="lp-node" style={{ left: "7%", top: "16%" }}>User query</div>
                <div className="lp-node on" style={{ left: "34%", top: "16%" }}>Agent</div>
                <div className="lp-node" style={{ left: "22%", top: "52%" }}>Vector store</div>
                <div className="lp-person lp-mono">speaker cutout</div>
              </div>
              <div style={{ background: "#fff", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--ok)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Your cut is ready
                </span>
                <span style={{ color: "var(--muted)" }}>Download MP4</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
