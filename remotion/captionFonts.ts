import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNunito } from "@remotion/google-fonts/Nunito";
import { loadFont as loadLora } from "@remotion/google-fonts/Lora";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";
import type { CaptionFont } from "@/types/renderOptions";

const opts = { weights: ["700", "800"] as ("700" | "800")[], subsets: ["latin"] as "latin"[] };

/** Font stack per caption setting. Each loads lazily, only when a caption layer actually uses it. */
const loaders: Record<CaptionFont, () => string> = {
  sans: () => `${loadInter("normal", opts).fontFamily}, "Helvetica Neue", Arial, sans-serif`,
  rounded: () => `${loadNunito("normal", opts).fontFamily}, "Arial Rounded MT Bold", sans-serif`,
  serif: () => `${loadLora("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily}, Georgia, serif`,
  mono: () => `${loadJetBrainsMono("normal", opts).fontFamily}, Menlo, monospace`,
  hand: () => `${loadCaveat("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily}, cursive`,
};

const cache = new Map<CaptionFont, string>();

export function captionFontFamily(font: CaptionFont): string {
  let family = cache.get(font);
  if (!family) {
    family = (loaders[font] ?? loaders.sans)();
    cache.set(font, family);
  }
  return family;
}
