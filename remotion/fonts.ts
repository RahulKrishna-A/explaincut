import { loadFont } from "@remotion/google-fonts/Caveat";

// Caveat reads as real marker handwriting while staying legible at small sizes.
const { fontFamily } = loadFont("normal", { weights: ["600", "700"], subsets: ["latin"] });

export const handFontFamily = fontFamily;
