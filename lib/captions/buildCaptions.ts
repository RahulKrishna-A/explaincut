/**
 * Word-timed captions: groups transcript words into short "pages" (what is
 * on screen at once) and works out the band at the bottom of the frame the
 * caption box lives in. Pure TypeScript - shared by the pipeline (to keep
 * drawings out of that band) and the Remotion caption layer.
 */
import { CAPTION_SIZE_SCALE, type CaptionFont, type CaptionSettings } from "@/types/renderOptions";
import type { FreeSpace } from "@/types/diagramPlan";
import type { TranscriptWord } from "@/types/transcript";

export interface CaptionWord {
  text: string;
  start: number; // seconds
  end: number;
}

export interface CaptionPage {
  start: number;
  end: number;
  words: CaptionWord[];
}

export interface CaptionMetrics {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  /** Max width of the text block (inside the box padding). */
  maxTextWidth: number;
  maxLines: number;
  /** Distance from the bottom of the frame to the bottom of the box. */
  bottomMargin: number;
  /** Top of the tallest possible box - drawings stay above this. */
  bandTop: number;
}

/** Average advance width (em) of each caption face at the bold weight we use. Slightly generous. */
const CHAR_EM: Record<CaptionFont, number> = { sans: 0.6, rounded: 0.58, serif: 0.58, mono: 0.62, hand: 0.48 };

const MAX_PAGE_SECONDS = 3.2;
const PAUSE_BREAK_SECONDS = 0.65;
const MAX_WORDS = 7;
const LINGER_SECONDS = 0.6;

export function captionMetrics(width: number, height: number, settings: CaptionSettings): CaptionMetrics {
  const u = Math.min(width, height) / 100;
  const portrait = height > width;
  const fontSize = Math.round((portrait ? u * 6.2 : u * 5.4) * CAPTION_SIZE_SCALE[settings.size] * (settings.font === "hand" ? 1.18 : 1));
  const lineHeight = Math.round(fontSize * 1.22);
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.3);
  const maxTextWidth = Math.round(width * (portrait ? 0.86 : 0.66) - padX * 2);
  const maxLines = 2;
  // Portrait reels put their own UI (caption, buttons) over the bottom ~10%.
  const bottomMargin = Math.round(height * (portrait ? 0.11 : 0.07));
  const bandTop = height - bottomMargin - (maxLines * lineHeight + padY * 2);
  return { fontSize, lineHeight, padX, padY, maxTextWidth, maxLines, bottomMargin, bandTop };
}

export function estimateCaptionWidth(text: string, fontSize: number, font: CaptionFont): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.3;
    else if ("iljI.,:;'!|".includes(ch)) em += 0.32;
    else if ("mwMW".includes(ch)) em += CHAR_EM[font] * 1.45;
    else if (ch >= "A" && ch <= "Z") em += CHAR_EM[font] * 1.15;
    else em += CHAR_EM[font];
  }
  return em * fontSize;
}

function linesNeeded(words: string[], m: CaptionMetrics, font: CaptionFont): number {
  let lines = 1;
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && estimateCaptionWidth(next, m.fontSize, font) > m.maxTextWidth) {
      lines++;
      line = w;
    } else line = next;
  }
  return lines;
}

/** Splits the transcript into caption pages that fit the box and break on pauses and sentence ends. */
export function buildCaptionPages(words: TranscriptWord[], metrics: CaptionMetrics, font: CaptionFont): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (current.length) pages.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
    current = [];
  };
  for (const w of words) {
    const text = w.word.trim();
    if (!text) continue;
    const word: CaptionWord = { text, start: w.startSeconds, end: Math.max(w.endSeconds, w.startSeconds + 0.05) };
    if (current.length) {
      const last = current[current.length - 1];
      const tooLong = word.end - current[0].start > MAX_PAGE_SECONDS;
      const pause = word.start - last.end > PAUSE_BREAK_SECONDS;
      const sentenceEnd = /[.?!]$/.test(last.text);
      const overflow = linesNeeded([...current.map((c) => c.text), text], metrics, font) > metrics.maxLines;
      // Don't strand a sentence's last word on its own page if it still fits.
      const tooMany = current.length >= MAX_WORDS && !(/[.?!,]$/.test(text) && current.length < MAX_WORDS + 2);
      if (tooLong || pause || sentenceEnd || overflow || tooMany) flush();
    }
    current.push(word);
  }
  flush();
  // Each page stays up until the next one starts (or briefly lingers after the last word).
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    pages[i].end = next ? Math.min(next.start, pages[i].end + LINGER_SECONDS) : pages[i].end + LINGER_SECONDS;
  }
  return pages;
}

/**
 * Keeps drawings out of the caption band: free-space regions are cut off
 * just above it. Regions that would become too thin are dropped; if that
 * leaves nothing, the original space is kept (drawing somewhere beats not drawing).
 */
export function reserveCaptionBand(space: FreeSpace, bandTop: number): FreeSpace {
  const u = Math.min(space.width, space.height) / 100;
  const limit = bandTop - u * 2;
  const regions = space.regions
    .map((r) => (r.y + r.h > limit ? { ...r, h: limit - r.y } : r))
    .filter((r) => r.h >= u * 12)
    .sort((a, b) => b.w * b.h - a.w * a.h);
  return regions.length > 0 ? { ...space, regions } : space;
}
