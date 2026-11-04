/**
 * Tone of voice per scene -> how that scene looks and moves.
 *
 * Muse Spark tags each scene with the speaker's tone. That one word picks the
 * sticker's art style (the Muse Image prompt), its physical material (how
 * light plays on it), how it arrives, and how much bounce every element in
 * the scene gets. Pure data - shared by the pipeline and the Remotion bundle.
 */

export const TONES = ["hype", "technical", "playful", "warning", "success", "calm"] as const;
export type Tone = (typeof TONES)[number];

/** How light plays across the sticker's surface. */
export type StickerMaterial = "holo" | "gold" | "gloss" | "matte" | "paper";
/** How the sticker arrives. */
export type StickerEntrance = "pop" | "slap" | "stamp" | "peel";

export interface ToneProfile {
  /** Art direction appended to every sticker prompt in this tone. */
  stickerStyle: string;
  /** Whether the sticker should borrow the video's accent palette (vs. its own signature colours). */
  usePalette: boolean;
  material: StickerMaterial;
  entrance: StickerEntrance;
  /** Seconds the entrance takes. */
  entranceSeconds: number;
  /** Motion energy: scales overshoot, squash and settle on every element (1 = neutral). */
  energy: number;
}

export const TONE_PROFILES: Record<Tone, ToneProfile> = {
  hype: {
    stickerStyle:
      "Puffy inflated 3D vinyl sticker look: soft glossy rounded volumes, bright saturated candy colours, crisp specular highlights, playful and bold.",
    usePalette: true,
    material: "holo",
    entrance: "pop",
    entranceSeconds: 0.45,
    energy: 1.35,
  },
  technical: {
    stickerStyle:
      "Clean isometric flat illustration: precise thin dark outlines, simple geometric shapes, cool blues and teals with one warm accent, no texture.",
    usePalette: true,
    material: "gloss",
    entrance: "peel",
    entranceSeconds: 0.8,
    energy: 0.8,
  },
  playful: {
    stickerStyle:
      "Cute hand-drawn doodle: bold dark marker outlines, flat bright colours, simple rounded shapes, a little character and humour.",
    usePalette: true,
    material: "gloss",
    entrance: "slap",
    entranceSeconds: 0.5,
    energy: 1.15,
  },
  warning: {
    stickerStyle:
      "Retro warning badge style: thick bold outlines, red, black and caution yellow, chunky shapes, slightly distressed print texture.",
    usePalette: false,
    material: "matte",
    entrance: "stamp",
    entranceSeconds: 0.4,
    energy: 1.2,
  },
  success: {
    stickerStyle:
      "Shiny gold foil embossed sticker: metallic gold and warm cream, raised embossed details, small sparkles, premium and celebratory.",
    usePalette: false,
    material: "gold",
    entrance: "pop",
    entranceSeconds: 0.5,
    energy: 1.1,
  },
  calm: {
    stickerStyle:
      "Layered paper-cut craft illustration: two or three stacked paper layers with soft shadows between them, muted warm pastels, gentle and friendly.",
    usePalette: true,
    material: "paper",
    entrance: "peel",
    entranceSeconds: 0.85,
    energy: 0.7,
  },
};

/** Scenes the planner didn't tag keep today's look. */
export const DEFAULT_TONE: Tone = "playful";

export function toneProfile(tone: Tone | undefined): ToneProfile {
  return TONE_PROFILES[tone ?? DEFAULT_TONE] ?? TONE_PROFILES[DEFAULT_TONE];
}
