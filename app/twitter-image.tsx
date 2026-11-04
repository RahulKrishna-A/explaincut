import { renderShareImage } from "@/lib/brand/shareImage";

export const alt = "ExplainCut: diagrams drawn behind you, in sync with your words";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderShareImage();
}
