import type { FreeRegion, FreeSpace, Rect, RegionSide, SketchTheme } from "@/types/diagramPlan";

/**
 * Best-guess free space when no segmentation is available (SAM failed, or
 * the Remotion Studio preview): a talking head is usually centred and
 * bottom-anchored, so draw above the head in portrait, beside it in landscape.
 */
export function defaultFreeSpace(width: number, height: number, theme: SketchTheme = "ink"): FreeSpace {
  const r = (x: number, y: number, w: number, h: number, side: RegionSide): FreeRegion => ({
    x: Math.round(x * width),
    y: Math.round(y * height),
    w: Math.round(w * width),
    h: Math.round(h * height),
    side,
  });

  if (height >= width) {
    return {
      width,
      height,
      theme,
      person: { x: width * 0.15, y: height * 0.32, w: width * 0.7, h: height * 0.68 },
      regions: [r(0.04, 0.05, 0.92, 0.25, "top")],
    };
  }
  return {
    width,
    height,
    theme,
    person: { x: width * 0.33, y: height * 0.15, w: width * 0.34, h: height * 0.85 },
    regions: [r(0.67, 0.08, 0.3, 0.8, "right"), r(0.03, 0.08, 0.3, 0.8, "left")],
  };
}

/** Labels a region by where it sits relative to the speaker. */
export function sideOf(region: Rect, person: Rect | undefined, width: number, height: number): RegionSide {
  if (!person) {
    const cx = region.x + region.w / 2;
    const cy = region.y + region.h / 2;
    if (cy < height * 0.33) return "top";
    if (cy > height * 0.67) return "bottom";
    return cx < width / 2 ? "left" : "right";
  }
  const tol = Math.min(width, height) * 0.03;
  if (region.y + region.h <= person.y + tol) return "top";
  if (region.x + region.w <= person.x + tol) return "left";
  if (region.x >= person.x + person.w - tol) return "right";
  if (region.y >= person.y + person.h - tol) return "bottom";
  return "center";
}
