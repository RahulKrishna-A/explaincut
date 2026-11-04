/**
 * User-facing render settings, chosen in the app before a job starts and
 * stored with the job. Everything here is optional at the API boundary and
 * falls back to DEFAULT_RENDER_OPTIONS.
 */

export const CAPTION_FONTS = ["sans", "rounded", "serif", "mono", "hand"] as const;
export type CaptionFont = (typeof CAPTION_FONTS)[number];

export const CAPTION_FONT_LABELS: Record<CaptionFont, string> = {
  sans: "Sans serif",
  rounded: "Rounded",
  serif: "Serif",
  mono: "Monospace",
  hand: "Handwritten",
};

export const CAPTION_SIZES = ["small", "medium", "large"] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];

/** Caption size multiplier - used by the render and the in-app preview, so they match. */
export const CAPTION_SIZE_SCALE: Record<CaptionSize, number> = { small: 0.82, medium: 1, large: 1.22 };

export interface CaptionSettings {
  /** Burn word-timed captions into the video (in a black box at the bottom). */
  enabled: boolean;
  font: CaptionFont;
  size: CaptionSize;
  /** Colour the word being spoken right now. */
  highlightActiveWord: boolean;
}

export interface SelfReviewSettings {
  /** Muse Wonder reviews the cut, Muse Spark fixes what it finds, and the cut is re-rendered. */
  enabled: boolean;
}

export interface RenderOptions {
  captions: CaptionSettings;
  selfReview: SelfReviewSettings;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  captions: {
    enabled: true,
    font: "sans",
    size: "medium",
    highlightActiveWord: true,
  },
  selfReview: {
    enabled: true,
  },
};
