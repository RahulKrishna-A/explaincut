import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/brand/site";
import "./landing.css";
import { BeforeAfter, DemoTabs, Faq } from "./LandingClient";
import { LogoMark } from "./LogoMark";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Structured data so search engines can show ExplainCut as an app.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  description: SITE.description,
  url: SITE.url,
  image: `${SITE.url}/opengraph-image`,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
};

const POWERED = ["Muse Spark", "Muse Voice Transcribe", "SAM 3.1", "Muse Wonder", "Muse Image", "Remotion"];
const MADE_FOR = ["Dev tutorials", "Lectures", "Onboarding", "Conference talks", "Course videos", "Team explainers", "Research walkthroughs", "And more"];
const BARS = [30, 55, 40, 80, 35, 90, 50, 70, 45, 85, 60, 95, 40];
const BAR_ON = [1, 3, 5, 7, 9, 11];
const MINI_WORDS: [string, string, boolean][] = [
  ["0:13.2", "gets", false], ["0:13.7", "embedded", false], ["0:14.1", "and", false], ["0:14.6", "written", false],
  ["0:15.0", "to", false], ["0:15.5", "a", false], ["0:15.9", "vector", true], ["0:16.4", "store", true],
];

const stepNum = (n: number) => <em>{n}</em>;

export default function Landing() {
  return (
    <div className="lp">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <nav className="lp-nav">
        <div className="lp-nav-in">
          <Link href="/" className="lp-logo"><LogoMark size={24} />ExplainCut</Link>
          <a href="#how" className="lp-link">How it works</a>
          <a href="#features" className="lp-link">What you get</a>
          <a href="#demo" className="lp-link">See it in action</a>
          <a href="#faq" className="lp-link">Questions</a>
          <Link href="/app" className="lp-cta-dark">Open app</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-glow" />
        <div className="lp-hero-in">
          <span className="lp-pill"><b>New</b>Built for the Meta AI Hackathon</span>
          <h1 className="lp-h1">Turn your explanation into an explainer</h1>
          <p className="lp-sub">Upload a webcam video. ExplainCut draws the diagram behind you, in sync with every word.</p>
          <div className="lp-drop">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.01 70)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" /><rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>
            <span>Drop a video or choose a file</span>
            <Link href="/app" className="lp-cta">Generate</Link>
          </div>
          <span className="lp-muted" style={{ fontSize: 13 }}>Runs locally · webcam framing and a plain background work best</span>
        </div>

        <div className="lp-shot-wrap">
          <BeforeAfter />
        </div>

        <div className="lp-chips">
          <span className="lp-muted" style={{ fontSize: 13, marginRight: 6 }}>Works with</span>
          {POWERED.map((p) => <span key={p} className="lp-chip">{p}</span>)}
        </div>
      </section>

      {/* MADE FOR */}
      <section style={{ padding: "24px 20px 8px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <span className="lp-muted" style={{ fontSize: 13 }}>Made for</span>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
            {MADE_FOR.map((m) => <span key={m} className="lp-chip soft">{m}</span>)}
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="lp-sec" style={{ paddingTop: 96 }}>
        <div className="lp-wrap">
          <h2 className="lp-h2">How it works</h2>
          <div className="lp-grid4">
            <div className="lp-card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="lp-viz" style={{ alignItems: "center" }}>
                <div style={{ width: "100%", background: "#fff", borderRadius: 8, padding: 10, display: "flex", gap: 10, alignItems: "center", boxShadow: "0 8px 20px -12px rgba(40,28,18,.25)" }}>
                  <div style={{ width: 52, aspectRatio: "16/10", borderRadius: 8, background: "repeating-linear-gradient(135deg,oklch(0.82 0.01 70) 0 5px,oklch(0.86 0.01 70) 5px 10px)" }} />
                  <div style={{ display: "flex", flexDirection: "column", fontSize: 12, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>agent-memory.mp4</span>
                    <span className="lp-muted">41 MB</span>
                  </div>
                </div>
              </div>
              <div className="lp-step">{stepNum(1)}<b>Upload your take</b><span>Webcam, plain background.</span></div>
            </div>
            <div className="lp-card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="lp-viz" style={{ flexWrap: "wrap", alignContent: "center", gap: 6 }}>
                {["the", "agent", "looks", "at"].map((w) => <span key={w} className="lp-w">{w}</span>)}
                <span className="lp-w on">short-term</span><span className="lp-w">memory</span>
              </div>
              <div className="lp-step">{stepNum(2)}<b>Transcribe every word</b><span>Each word gets a timestamp.</span></div>
            </div>
            <div className="lp-card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="lp-viz" style={{ flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px -6px rgba(40,28,18,.25)" }}>Agent</span>
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>→</span>
                  <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}>Context</span>
                </div>
                <span className="lp-mono" style={{ fontSize: 11, color: "var(--muted)", background: "#fff", padding: "4px 8px", borderRadius: 6 }}>connect · 0:10.8</span>
              </div>
              <div className="lp-step">{stepNum(3)}<b>AI plans the diagram</b><span>Each box is tied to a word.</span></div>
            </div>
            <div className="lp-card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="lp-viz" style={{ flexDirection: "column", justifyContent: "center", gap: 12 }}>
                <div className="ec-bar" style={{ height: 8 }}>{[0, 1, 2, 3, 4].map((i) => <span key={i} data-state="done" />)}</div>
                <span style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--ink)", padding: "8px 14px", borderRadius: 6 }}>Download MP4</span>
              </div>
              <div className="lp-step">{stepNum(4)}<b>Download the cut</b><span>Diagram behind, you in front.</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="lp-sec">
        <div className="lp-wrap">
          <h2 className="lp-h2">What you get</h2>
          <div className="lp-grid3">
            <div className="lp-card">
              <div className="lp-viz tall" style={{ background: "linear-gradient(160deg,oklch(0.97 0.01 70),oklch(0.94 0.02 45))", position: "relative", overflow: "hidden", padding: 0 }}>
                <div className="lp-node" style={{ left: "10%", top: "22%", fontSize: 14, padding: "8px 14px" }}>Working</div>
                <div className="lp-node on" style={{ left: "10%", top: "50%", fontSize: 14, padding: "8px 14px" }}>Semantic</div>
                <div className="lp-person lp-mono" style={{ width: "34%", height: "82%", fontSize: 10, paddingBottom: 10 }}>you</div>
              </div>
              <div className="lp-feat"><b>You stay in front</b><span>SAM 3.1 cuts you out of every frame, so diagrams never cover your face.</span></div>
            </div>
            <div className="lp-card">
              <div className="lp-viz tall" style={{ flexDirection: "column", justifyContent: "center", gap: 10, padding: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(13,1fr)", gap: 4, alignItems: "end", height: 56 }}>
                  {BARS.map((h, i) => <div key={i} style={{ height: `${h}%`, borderRadius: 4, background: BAR_ON.includes(i) ? "var(--accent)" : "oklch(0.88 0.01 70)" }} />)}
                </div>
                <div className="lp-muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>0:00</span><span>end</span></div>
              </div>
              <div className="lp-feat"><b>Diagrams that build on cue</b><span>Each box is drawn on the frame you say its name.</span></div>
            </div>
            <div className="lp-card">
              <div className="lp-viz tall" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 20 }}>
                {["Flow", "Stack"].map((n, k) => (
                  <div key={n} style={{ background: "#fff", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", boxShadow: "0 6px 16px -10px rgba(40,28,18,.25)" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{n}</span>
                    {k === 0 ? (
                      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 22, height: 16, borderRadius: 5, background: "oklch(0.9 0.01 70)" }} /><span style={{ fontSize: 11, color: "var(--accent)" }}>→</span>
                        <span style={{ width: 22, height: 16, borderRadius: 5, background: "var(--accent)" }} /><span style={{ fontSize: 11, color: "var(--accent)" }}>→</span>
                        <span style={{ width: 22, height: 16, borderRadius: 5, background: "oklch(0.9 0.01 70)" }} />
                      </div>
                    ) : (
                      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ height: 12, borderRadius: 5, background: "oklch(0.9 0.01 70)" }} />
                        <span style={{ height: 12, borderRadius: 5, background: "oklch(0.9 0.01 70)" }} />
                        <span style={{ height: 12, borderRadius: 5, background: "var(--accent)" }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="lp-feat"><b>The right picture for each idea</b><span>Flows, hubs, stacks, cycles, comparisons, trees, timelines and hand-drawn bar, line and pie charts, chosen per scene of your explanation.</span></div>
            </div>
            <div className="lp-card">
              <div className="lp-viz tall lp-mono" style={{ background: "var(--ink)", color: "oklch(0.92 0.005 70)", flexDirection: "column", padding: "20px 22px", fontSize: 12, lineHeight: 1.7, overflow: "hidden", justifyContent: "flex-start" }}>
                <div>{"{ \"layout\": \"flow\","}</div>
                <div>{"  \"ops\": ["}</div>
                <div>{"    { \"type\": "}<span style={{ color: "oklch(0.78 0.13 45)" }}>&quot;draw&quot;</span>{","}</div>
                <div>{"      \"target\": \"agent\" },"}</div>
                <div>{"    { \"type\": "}<span style={{ color: "oklch(0.78 0.13 45)" }}>&quot;connect&quot;</span>{","}</div>
                <div>{"      \"target\": \"query-agent\" }"}</div>
              </div>
              <div className="lp-feat"><b>Drawn in code, not generated</b><span>Every label is rendered from a plan, so nothing is misspelled.</span></div>
            </div>
            <div className="lp-card">
              <div className="lp-viz tall" style={{ flexWrap: "wrap", alignContent: "center", gap: "8px 6px", padding: 22 }}>
                {MINI_WORDS.map(([t, w, on]) => (
                  <span key={t} style={{ display: "flex", flexDirection: "column", padding: "4px 8px", borderRadius: 6, background: on ? "var(--accent-soft)" : "#fff", color: on ? "var(--accent-ink)" : "inherit" }}>
                    <span style={{ fontSize: 9, opacity: 0.7 }}>{t}</span>
                    <span style={{ fontSize: 14, fontWeight: on ? 600 : 400 }}>{w}</span>
                  </span>
                ))}
              </div>
              <div className="lp-feat"><b>Word-level timing</b><span>Every word is timestamped, so each part of the diagram lands on its trigger word.</span></div>
            </div>
            <div className="lp-card">
              <div className="lp-viz tall" style={{ flexDirection: "column", justifyContent: "center", gap: 8, padding: 20 }}>
                {[["medium", "Label overlaps the speaker"], ["low", "Node lands a beat late"]].map(([sev, d]) => (
                  <div key={sev} style={{ background: "#fff", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{d}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "var(--warn-soft)", padding: "3px 10px", borderRadius: 6 }}>{sev}</span>
                  </div>
                ))}
              </div>
              <div className="lp-feat"><b>A review that fixes itself</b><span>Muse Wonder checks relevance, timing and speaker overlap; Muse Spark re-plans what&apos;s off and the video is re-rendered before you see it.</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section id="demo" className="lp-sec">
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <div style={{ textAlign: "center" }}>
            <h2 className="lp-h2">See it in action</h2>
            <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>This is the real app, running on localhost.</p>
          </div>
          <DemoTabs />
          <Link href="/app" className="lp-cta-dark" style={{ fontSize: 15, padding: "13px 22px" }}>Try it yourself</Link>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="lp-sec">
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h2 className="lp-h2">Your questions, answered</h2>
            <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>Everything you need to know.</p>
          </div>
          <Faq />
        </div>
      </section>

      {/* CLOSE */}
      <section style={{ padding: "112px 20px 24px" }}>
        <div className="lp-close">
          <h2>Make your first explainer today</h2>
          <Link href="/app">Upload a video</Link>
        </div>
      </section>

      <footer className="lp-foot">
        <span style={{ fontWeight: 700, color: "var(--ink)", marginRight: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <LogoMark size={20} />ExplainCut
        </span>
        <a href="#how">How it works</a>
        <a href="#features">What you get</a>
        <a href="#demo">See it in action</a>
        <a href="#faq">Questions</a>
        <span>© 2026 ExplainCut</span>
      </footer>
    </div>
  );
}
