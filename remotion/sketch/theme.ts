import type { Accent, SketchTheme } from "@/types/diagramPlan";

export interface Palette {
  ink: string;
  paper: string;
  paperOpacity: number;
  /** Outline drawn under every stroke/text so it reads on any background. */
  halo: string;
  haloOpacity: number;
  shadowOpacity: number;
  accents: Record<Accent, string>;
}

export const PALETTES: Record<SketchTheme, Palette> = {
  // Dark marker on a light wall - whiteboard-explainer look.
  ink: {
    ink: "#1c1e2b",
    paper: "#fffdf6",
    paperOpacity: 0.9,
    halo: "#ffffff",
    haloOpacity: 0.85,
    shadowOpacity: 0.22,
    accents: {
      blue: "#2f6fed",
      pink: "#e5397a",
      green: "#14a35b",
      orange: "#f2760c",
      purple: "#7b4dff",
      yellow: "#ffcf1f",
    },
  },
  // Bright chalk on a dark room.
  chalk: {
    ink: "#f8f8fc",
    paper: "#11131c",
    paperOpacity: 0.74,
    halo: "#05060a",
    haloOpacity: 0.7,
    shadowOpacity: 0.4,
    accents: {
      blue: "#6fa8ff",
      pink: "#ff78a9",
      green: "#55e38e",
      orange: "#ffab52",
      purple: "#b69cff",
      yellow: "#ffe45c",
    },
  },
};

/** Journal style: warm cream paper, soft pastel markers - scrapbook rather than whiteboard. */
export const JOURNAL_PALETTES: Record<SketchTheme, Palette> = {
  ink: {
    ink: "#3a2f2a",
    paper: "#fff6e3",
    paperOpacity: 0.94,
    halo: "#fff6e3",
    haloOpacity: 0.8,
    shadowOpacity: 0.26,
    accents: { blue: "#5b8def", pink: "#f0679c", green: "#4fb37c", orange: "#f59a3d", purple: "#9a7bf0", yellow: "#ffd54a" },
  },
  chalk: {
    ink: "#fff1d6",
    paper: "#2a211c",
    paperOpacity: 0.78,
    halo: "#140f0c",
    haloOpacity: 0.7,
    shadowOpacity: 0.42,
    accents: { blue: "#8db6ff", pink: "#ff8fb6", green: "#7fe0a6", orange: "#ffb865", purple: "#c4aeff", yellow: "#ffe27a" },
  },
};

/** Hormozi style: near-black cards, white ink, electric accents - high contrast on any footage. */
const HORMOZI: Palette = {
  ink: "#ffffff",
  paper: "#0b0b10",
  paperOpacity: 0.93,
  halo: "#000000",
  haloOpacity: 0.9,
  shadowOpacity: 0.5,
  accents: { blue: "#38bdf8", pink: "#ff4d8d", green: "#39e07a", orange: "#ff9f1c", purple: "#a78bfa", yellow: "#ffe600" },
};
export const HORMOZI_PALETTES: Record<SketchTheme, Palette> = { ink: HORMOZI, chalk: HORMOZI };
