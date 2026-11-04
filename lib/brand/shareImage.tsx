import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE } from "./site";

// Shared 1200×630 card for opengraph-image and twitter-image.

export const SHARE_SIZE = { width: 1200, height: 630 };
export const SHARE_ALT = `${SITE.name}: diagrams drawn behind you, in sync with your words`;

const { accent, accentLight, ink, cream } = SITE.colors;
const MUTED = "#6e675f";

const HEADLINE_A = "Turn your explanation";
const HEADLINE_B = "into an";
const HEADLINE_C = "explainer.";
const CHIP = "“vector store” · 0:14.6";
const BOARD_A = "Agent";
const BOARD_B = "Memory";

// Fetch only the glyphs the card uses. If Google Fonts is unreachable at
// build time, fall back to the renderer's bundled font rather than failing.
async function loadDmSans(weight: 400 | 700, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=DM+Sans:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl)).text();
    const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    const res = await fetch(src);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

const markSvg = readFile(join(process.cwd(), "app/icon.svg"), "utf8");
const boldText = SITE.name + HEADLINE_A + HEADLINE_B + HEADLINE_C + BOARD_A + BOARD_B;
const regularText = SITE.shortDescription + CHIP;
const fontsReady = Promise.all([loadDmSans(700, boldText), loadDmSans(400, regularText)]);

export async function renderShareImage() {
  const [svg, [bold, regular]] = await Promise.all([markSvg, fontsReady]);
  const markSrc = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const fonts = [
    ...(bold ? [{ name: "DM Sans", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(regular ? [{ name: "DM Sans", data: regular, weight: 400 as const, style: "normal" as const }] : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: cream,
          backgroundImage: "radial-gradient(circle at 82% 8%, #ffd9c4 0%, rgba(251,250,247,0) 55%)",
          fontFamily: fonts.length ? "DM Sans" : undefined,
          color: ink,
        }}
      >
        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", padding: "76px 0 0 80px", width: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={markSrc} width={64} height={64} alt="" />
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.7 }}>{SITE.name}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 104, fontSize: 68, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.08 }}>
            <span>{HEADLINE_A}</span>
            <span style={{ display: "flex", gap: 18 }}>
              <span>{HEADLINE_B}</span>
              <span style={{ color: accent }}>{HEADLINE_C}</span>
            </span>
          </div>

          <div style={{ display: "flex", marginTop: 30, fontSize: 28, lineHeight: 1.36, color: MUTED, width: 640 }}>
            {SITE.shortDescription}
          </div>

          <div style={{ display: "flex", marginTop: 36 }}>
            <span style={{ fontSize: 21, color: "#8e1e00", background: "#ffe8dc", padding: "9px 18px", borderRadius: 8 }}>{CHIP}</span>
          </div>
        </div>

        {/* right: a small chalkboard scene */}
        <div style={{ position: "absolute", left: 860, top: 150, width: 260, height: 330, display: "flex", background: ink, borderRadius: 18 }}>
          <svg width="260" height="330" viewBox="0 0 260 330" style={{ position: "absolute", left: 0, top: 0 }}>
            <path d="M30 42c38-5 76-4 112 1 3 22 2 42-1 64-37 4-74 3-110-1-4-21-4-43-1-64z" fill="none" stroke={cream} strokeWidth="5" strokeLinejoin="round" />
            <path d="M86 128c-3 40 12 72 50 86" fill="none" stroke={accentLight} strokeWidth="5" strokeLinecap="round" />
            <path d="M118 224l20-9-9-20" fill="none" stroke={accentLight} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="146" y="190" width="94" height="60" rx="10" fill={accentLight} />
          </svg>
          <span style={{ position: "absolute", left: 30, top: 58, width: 112, display: "flex", justifyContent: "center", fontSize: 22, fontWeight: 700, color: cream }}>{BOARD_A}</span>
          <span style={{ position: "absolute", left: 146, top: 207, width: 94, display: "flex", justifyContent: "center", fontSize: 18, fontWeight: 700, color: ink }}>{BOARD_B}</span>
        </div>
      </div>
    ),
    { ...SHARE_SIZE, fonts },
  );
}
