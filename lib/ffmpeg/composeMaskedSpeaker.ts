import { runFfmpeg } from "./run";

/**
 * Composites the diagram onto the ORIGINAL, untouched video - never a
 * synthetic replacement background. The diagram layer (ProRes 4444, real
 * alpha) has its own alpha punched by the inverted person mask
 * (diagramAlpha * (1 - personMask)), so diagram elements vanish wherever the
 * person's segmentation mask says they are, and stay fully visible
 * everywhere else against the real background. The result is overlaid on
 * the original video, so the person and the background are both exactly as
 * recorded.
 */
export async function composeDiagramBehindPerson(
  originalVideoPath: string,
  diagramLayerMovPath: string,
  maskVideoPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    originalVideoPath,
    "-i",
    diagramLayerMovPath,
    "-i",
    maskVideoPath,
    "-filter_complex",
    [
      "[1:v]alphaextract[diagA]",
      "[2:v]format=gray,negate[invMask]",
      "[diagA][invMask]blend=all_mode=multiply,format=gray[finalA]",
      "[1:v][finalA]alphamerge[diagPunched]",
      "[0:v][diagPunched]overlay=format=auto[outv]",
    ].join(";"),
    "-map",
    "[outv]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);
}

/**
 * Catastrophic-failure fallback: overlays the diagram directly on the
 * original video using only the diagram's own alpha (no person punch-out).
 * Used only if mask building fails outright - still never touches the
 * background, but diagrams may cover the person until that's fixed.
 */
export async function composeDiagramOverlay(
  originalVideoPath: string,
  diagramLayerMovPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    originalVideoPath,
    "-i",
    diagramLayerMovPath,
    "-filter_complex",
    "[0:v][1:v]overlay=format=auto[outv]",
    "-map",
    "[outv]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);
}
