"use client";

import { cloneElement, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

const TEXT =
  "So when an agent answers a query it can't just rely on the model. First the user query comes in and the agent looks at its short-term memory, which is really just the context window. Anything older gets embedded and written to a vector store. On the next turn the agent retrieves the closest matches and pulls them back into context. You can think of it as three layers.";
const WORDS = TEXT.split(" ");

const A = "var(--accent)";
const AS = "var(--accent-soft)";
const AI = "var(--accent-ink)";
const SH = "0 6px 18px -8px rgba(50,35,20,.28)";
const STRIPE = "repeating-linear-gradient(135deg,oklch(0.8 0.01 70) 0 8px,oklch(0.84 0.01 70) 8px 16px)";

const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });
const fmt = (t: number) => `0:${t.toFixed(1).padStart(4, "0")}`;

function useTick(ms: number, max: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % max), ms);
    return () => clearInterval(t);
  }, [ms, max]);
  return n;
}

function Wave() {
  return (
    <div style={abs({ left: 16, right: 16, bottom: 14, height: 34, display: "flex", gap: 3, alignItems: "center" })}>
      {Array.from({ length: 56 }, (_, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            height: "100%",
            borderRadius: 2,
            background: i % 7 === 0 ? A : "oklch(0.75 0.03 45)",
            transformOrigin: "center",
            animation: `ecWave ${0.6 + ((i * 37) % 9) / 10}s ease-in-out ${-((i * 0.13) % 1)}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function TranscribeScene() {
  const i = useTick(95, WORDS.length + 14);
  const n = Math.min(i, WORDS.length);
  const off = Math.max(0, n - 34);
  const cur = n - 1;
  const t = 0.4 + cur * 0.38;
  return (
    <div className="ecw-scene">
      <div style={abs({ left: 18, right: 150, top: 46, bottom: 60, display: "flex", flexWrap: "wrap", alignContent: "flex-end", gap: "6px 2px", fontSize: 19, lineHeight: 1.25, overflow: "hidden" })} className="ecw-side-wide">
        {WORDS.slice(off, n).map((w, k) => {
          const idx = off + k;
          const age = cur - idx;
          const st: CSSProperties =
            age === 0
              ? { background: A, color: "#fff", transform: "scale(1.06)" }
              : age < 4
                ? { background: AS, color: AI }
                : { color: age < 10 ? "var(--ink)" : "oklch(0.6 0.01 70)" };
          return (
            <span key={idx} style={{ padding: "2px 6px", borderRadius: 5, transition: "all .25s ease", fontWeight: age < 4 ? 600 : 400, ...st }}>
              {w}
            </span>
          );
        })}
      </div>
      <div className="ecw-side" style={abs({ right: 16, top: 46, width: 120, display: "flex", flexDirection: "column", gap: 8 })}>
        <div className="ecw-stat"><small>Timestamp</small><b style={{ color: AI }}>{fmt(Math.max(0.4, t))}</b></div>
        <div className="ecw-stat"><small>Words</small><b>{n}</b></div>
      </div>
      <Wave />
    </div>
  );
}

export function PlanScene() {
  const an = (a: string) => `${a} 9s ease-in-out infinite`;
  const node = (label: string, s: CSSProperties, a: string, accent?: boolean) => (
    <div className="ecw-pill" data-accent={!!accent} style={{ ...abs(s), animation: an(a) }}>{label}</div>
  );
  const arrow = (s: CSSProperties, d: string, w: number, ht: number, a: string) => (
    <svg style={{ ...abs(s), overflow: "visible" }} width={w} height={ht} viewBox={`0 0 ${w} ${ht}`}>
      <path d={d} fill="none" stroke={A} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={60} style={{ animation: an(a) }} />
    </svg>
  );
  const cap = (word: string, op: string, a: string) => (
    <div style={{ ...abs({ inset: 0 }), display: "flex", alignItems: "center", gap: 8, padding: "0 12px", animation: an(a), opacity: 0 }}>
      <span style={{ padding: "1px 6px", borderRadius: 4, background: AS, color: AI, fontWeight: 600 }}>{word}</span>
      <span style={{ color: "var(--muted-2)" }}>→</span>
      <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 12 }}>{op}</span>
    </div>
  );
  return (
    <div className="ecw-scene">
      {node("User query", { left: "6%", top: "26%" }, "ecA")}
      {arrow({ left: "24.5%", top: "32%" }, "M0 8h50m-7-7 7 7-7 7", 56, 16, "ecD1")}
      {node("Agent", { left: "34%", top: "26%" }, "ecB", true)}
      {arrow({ left: "38.5%", top: "46%" }, "M8 0v40m-7-7 7 7 7-7", 16, 44, "ecD2")}
      {node("Memory", { left: "32%", top: "64%" }, "ecC")}
      <div className="ecw-side" style={abs({ right: "6%", top: 46, width: 230, height: 34, borderRadius: 8, background: "#fff", boxShadow: SH, fontSize: 14 })}>
        {cap("“user query”", "addNode query", "ecCapA")}
        {cap("“agent”", "addEdge → agent", "ecCapB")}
        {cap("“memory”", "addNode memory", "ecCapC")}
      </div>
      <div className="ecw-side" style={abs({ right: "6%", top: 92, width: 230, fontSize: 12, color: "var(--muted-2)", lineHeight: 1.5 })}>
        Each box is pinned to the word that introduces it.
      </div>
    </div>
  );
}

function Silhouette({ bg }: { bg: string }) {
  return (
    <>
      <div style={abs({ left: "50%", top: "12%", width: 64, height: 64, transform: "translateX(-50%)", borderRadius: "50%", background: bg })} />
      <div style={abs({ left: "50%", bottom: 0, width: 170, height: "52%", transform: "translateX(-50%)", borderRadius: "70px 70px 0 0", background: bg })} />
    </>
  );
}

export function CutoutScene() {
  const f = useTick(40, 1440);
  const frames: ReactElement[] = Array.from({ length: 24 }, (_, i) => (
    <div key={i} style={{ flex: "none", width: 54, height: 32, borderRadius: 4, background: STRIPE, position: "relative", overflow: "hidden" }}>
      <div style={abs({ left: "34%", bottom: 0, width: "32%", height: "70%", borderRadius: "10px 10px 0 0", background: i % 3 === 0 ? A : "oklch(0.72 0.09 40)" })} />
    </div>
  ));
  return (
    <div className="ecw-scene">
      <div style={abs({ left: 18, top: 46, width: 300, maxWidth: "calc(100% - 36px)", bottom: 62, borderRadius: 8, overflow: "hidden", background: STRIPE })}>
        <Silhouette bg="oklch(0.68 0.012 70)" />
        <div style={abs({ left: 0, right: 0, top: 0, overflow: "hidden", animation: "ecReveal 3.6s ease-in-out infinite" })}>
          <div style={abs({ left: 0, right: 0, top: 0, height: 162, background: "oklch(0.955 0.012 75)" })}><Silhouette bg={A} /></div>
        </div>
        <div style={abs({ left: 0, right: 0, height: 2, background: A, boxShadow: "0 0 12px 2px oklch(0.58 0.16 45 / 0.5)", animation: "ecScanLine 3.6s ease-in-out infinite" })} />
      </div>
      <div className="ecw-side" style={abs({ left: 338, top: 46, right: 18, display: "flex", flexDirection: "column", gap: 8 })}>
        <div className="ecw-stat"><small>Frame</small><b>{(f + 1).toLocaleString()} / 1,440</b></div>
        <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>Finding you in each frame, so the diagram can sit behind you.</div>
      </div>
      <div style={abs({ left: 18, right: 18, bottom: 14, height: 32, overflow: "hidden" })}>
        <div style={{ display: "flex", gap: 6, width: "max-content", animation: "ecStrip 6s linear infinite" }}>
          {frames}
          {frames.map((x, i) => cloneElement(x, { key: "b" + i }))}
        </div>
      </div>
    </div>
  );
}

export function RenderScene() {
  const f = useTick(30, 1440);
  const layer = (label: string, z: number, anim: string | null, style: CSSProperties, children?: ReactNode) => (
    <div style={{ ...abs({ left: "50%", top: 58, width: 300, height: 150, marginLeft: -150, borderRadius: 8, zIndex: z }), animation: anim ? `${anim} 6s ease-in-out infinite` : "none", ...style }}>
      {children}
      <span style={abs({ right: 8, top: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,.92)", animation: "ecLbl 6s ease-in-out infinite" })}>{label}</span>
    </div>
  );
  const pct = (f / 1440) * 100;
  return (
    <div className="ecw-scene">
      {layer("Background", 1, "ecBack", { background: "oklch(0.9 0.015 75)", boxShadow: SH })}
      {layer("Diagram", 2, null, { background: "transparent", border: "1.5px dashed oklch(0.75 0.05 45)" }, <>
        <div className="ecw-mini" style={abs({ left: 22, top: 40 })}>User query</div>
        <div className="ecw-mini" data-accent="true" style={abs({ left: 120, top: 40 })}>Agent</div>
        <div className="ecw-mini" style={abs({ left: 108, top: 92 })}>Memory</div>
      </>)}
      {layer("You", 3, "ecFront", { background: "transparent" }, <div style={abs({ right: 30, bottom: 0, width: 80, height: 110, borderRadius: "40px 40px 0 0", background: STRIPE })} />)}
      <div style={abs({ left: 18, right: 18, bottom: 14, height: 30, borderRadius: 6, background: "#fff", boxShadow: SH, overflow: "hidden", zIndex: 4 })}>
        <div style={abs({ inset: 0, backgroundImage: "repeating-linear-gradient(90deg,oklch(0.9 0.01 70) 0 1px,transparent 1px 12px)" })} />
        <div style={abs({ top: 0, bottom: 0, left: 0, width: `${pct}%`, background: AS })} />
        <div style={abs({ top: 0, bottom: 0, width: 2, left: `${pct}%`, background: A })} />
        <span style={abs({ right: 10, top: 7, fontFamily: "var(--font-mono), monospace", fontSize: 12 })}>frame {(f + 1).toLocaleString()} / 1,440</span>
      </div>
    </div>
  );
}

export function ReviewScene() {
  const an = (a: string) => `${a} 7s ease-in-out infinite`;
  const check = (label: string, note: string, a: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 8, padding: "9px 12px", boxShadow: SH, animation: an(a), opacity: 0 }}>
      <span style={{ width: 22, height: 22, borderRadius: 99, background: "var(--ok-soft)", display: "grid", placeItems: "center", color: "var(--ok)", fontSize: 12, fontWeight: 700 }}>✓</span>
      <div><div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 11, color: "var(--muted-2)" }}>{note}</div></div>
    </div>
  );
  return (
    <div className="ecw-scene">
      <div style={abs({ left: 18, top: 46, width: 380, maxWidth: "calc(100% - 36px)", bottom: 16, borderRadius: 8, overflow: "hidden", background: "oklch(0.93 0.012 75)" })}>
        <div className="ecw-mini" style={abs({ left: "8%", top: "20%" })}>User query</div>
        <div className="ecw-mini" data-accent="true" style={abs({ left: "36%", top: "20%" })}>Agent</div>
        <div className="ecw-mini" style={abs({ left: "30%", top: "60%" })}>Memory</div>
        <div style={abs({ right: "8%", bottom: 0, width: "26%", height: "78%", borderRadius: "40px 40px 0 0", background: STRIPE })} />
        <div style={{ ...abs({ width: 110, height: 56, border: `2px solid ${A}`, borderRadius: 8, boxShadow: "0 0 0 400px rgba(40,28,15,.12)", marginLeft: -12, marginTop: -12 }), animation: "ecRet 7s ease-in-out infinite" }} />
      </div>
      <div className="ecw-side" style={abs({ left: 418, top: 46, right: 18, display: "flex", flexDirection: "column", gap: 8 })}>
        {check("Relevance", "Diagram matches what you said", "ecK1")}
        {check("Timing", "Each box lands on its word", "ecK2")}
        {check("Face overlap", "Nothing hides behind you", "ecK3")}
      </div>
    </div>
  );
}
