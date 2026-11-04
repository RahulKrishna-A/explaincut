// Single source for the site's name, copy and public URL, used by metadata,
// the share image, robots.txt, sitemap.xml and the web manifest.

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "ExplainCut",
  url: resolveSiteUrl(),
  tagline: "Turn your explanation into an explainer",
  /** ~150 chars: what search results and link previews show under the title. */
  description:
    "Upload a talking-head video and ExplainCut draws hand-drawn diagrams behind you, timed to every word. Made for tutorials, lectures and explainers.",
  /** Shorter line for the share image and manifest. */
  shortDescription: "Upload a webcam video. ExplainCut draws the diagram behind you, in sync with every word.",
  keywords: [
    "explainer video",
    "AI video editor",
    "animated diagrams",
    "talking head video",
    "whiteboard animation",
    "tutorial video maker",
    "lecture video",
    "auto captions",
    "video diagram generator",
  ],
  colors: {
    accent: "#c4530f",
    accentLight: "#ed7940",
    ink: "#1e1a15",
    cream: "#fbfaf7",
  },
} as const;
