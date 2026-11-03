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
