import { runFfmpeg } from "./run";

/** Hormozi-style punch-ins: a slow push-in that hard-cuts back, alternating a tighter and a wider framing. */
export interface ZoomSpec {
  width: number;
  height: number;
}

function zoomFilter({ width: w, height: h }: ZoomSpec): string {
  const z = "(1+0.05*mod(floor(t/3.4),2)+0.055*mod(t,3.4)/3.4)";
  return `scale=w='ceil(${w}*${z}/2)*2':h='ceil(${h}*${z}/2)*2':eval=frame,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*0.3`;
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
  zoom?: ZoomSpec
): Promise<void> {
  const filters = [
    "[1:v]alphaextract[diagA]",
    "[2:v]format=gray,negate[invMask]",
    "[diagA][invMask]blend=all_mode=multiply,format=gray[finalA]",
    "[1:v][finalA]alphamerge[diagPunched]",
  ];
  // Captions go on last, over the speaker - they're never punched out.
  // Zoom frames the finished composite (video + drawings together); captions stay put on top.
  const base = zoom ? "zoomed" : "withDiag";
  filters.push("[0:v][diagPunched]overlay=format=auto[withDiag]");
  if (zoom) filters.push(`[withDiag]${zoomFilter(zoom)}[zoomed]`);
  filters.push(captionLayerMovPath ? `[${base}][3:v]overlay=format=auto[outv]` : `[${base}]null[outv]`);
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
  captionLayerMovPath?: string,
  zoom?: ZoomSpec
): Promise<void> {
  const base = zoom ? "zoomed" : "withDiag";
  const filters = ["[0:v][1:v]overlay=format=auto[withDiag]"];
  if (zoom) filters.push(`[withDiag]${zoomFilter(zoom)}[zoomed]`);
  filters.push(captionLayerMovPath ? `[${base}][2:v]overlay=format=auto[outv]` : `[${base}]null[outv]`);
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
