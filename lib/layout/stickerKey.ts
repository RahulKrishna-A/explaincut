import { DEFAULT_TONE, type Tone } from "@/lib/style/tone";

/**
 * How a sticker op maps to its generated asset (shared by Node and the
 * Remotion bundle). The tone is part of the key: the same subject is drawn in
 * a different art style per tone, so they're different images.
 */
export function stickerKey(subject: string, tone: Tone = DEFAULT_TONE): string {
  return `${tone}|${subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/** Key used before stickers had tones - so jobs made earlier keep their stickers when re-rendered. */
export function legacyStickerKey(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
