import { loadFont } from "@remotion/google-fonts/Caveat";

// Caveat reads as real marker handwriting while staying legible at small sizes.
const { fontFamily } = loadFont("normal", { weights: ["600", "700"], subsets: ["latin"] });

export const handFontFamily = fontFamily;

import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

/** Heavy geometric sans for the Hormozi look (captions + big keywords). */
export const heavyFontFamily = `${loadMontserrat("normal", { weights: ["800", "900"], subsets: ["latin"] }).fontFamily}, "Arial Black", sans-serif`;
