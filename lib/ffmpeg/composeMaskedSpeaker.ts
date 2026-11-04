import { runFfmpeg } from "./run";

/** Seconds [from, to] where the full-screen black board is up (fades included). */
export type BoardWindows = [number, number][];

/** ffmpeg timeline expression: non-zero while any board window is up. */
function boardExpr(boards: BoardWindows): string {
  return boards.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
}

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
  outputPath: string,
  captionLayerMovPath?: string,
  boards: BoardWindows = []
): Promise<void> {
  const filters = [
    "[1:v]alphaextract[diagA]",
    "[2:v]format=gray,negate[invMask]",
    "[diagA][invMask]blend=all_mode=multiply,format=gray[finalA]",
    "[1:v][finalA]alphamerge[diagPunched]",
  ];
  // Captions go on last, over the speaker - they're never punched out.
  if (boards.length) {
    // While the black board is up the layer covers the whole frame - nothing to tuck behind,
    // so the un-punched layer goes on instead (exactly one of the two, or fades would double up).
    const on = boardExpr(boards);
    filters.push(`[0:v][diagPunched]overlay=format=auto:enable='not(${on})'[withSpeaker]`);
    filters.push(`[withSpeaker][1:v]overlay=format=auto:enable='${on}'[withDiag]`);
  } else {
    filters.push("[0:v][diagPunched]overlay=format=auto[withDiag]");
  }
  filters.push(captionLayerMovPath ? "[withDiag][3:v]overlay=format=auto[outv]" : "[withDiag]null[outv]");
  await runFfmpeg([
    "-y",
    "-i",
    originalVideoPath,
    "-i",
    diagramLayerMovPath,
    "-i",
    maskVideoPath,
    ...(captionLayerMovPath ? ["-i", captionLayerMovPath] : []),
    "-filter_complex",
    filters.join(";"),
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
    // moov atom up front: playback starts before the whole file has downloaded.
    "-movflags",
    "+faststart",
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
  outputPath: string,
  captionLayerMovPath?: string
): Promise<void> {
  // No punch-out here, so the board needs no special handling: the layer simply covers everything.
  const filters = ["[0:v][1:v]overlay=format=auto[withDiag]"];
  filters.push(captionLayerMovPath ? "[withDiag][2:v]overlay=format=auto[outv]" : "[withDiag]null[outv]");
  await runFfmpeg([
    "-y",
    "-i",
    originalVideoPath,
    "-i",
    diagramLayerMovPath,
    ...(captionLayerMovPath ? ["-i", captionLayerMovPath] : []),
    "-filter_complex",
    filters.join(";"),
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
    // moov atom up front: playback starts before the whole file has downloaded.
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}
