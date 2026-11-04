import React, { useEffect, useState } from "react";
import { spring, useDelayRender } from "remotion";
import type { StickerElement } from "@/types/diagramPlan";
import { InkPath, clamp01, safeId, type DrawCtx } from "./elements";
import { handLine, rng, toPath, type Pt } from "./rough";

/**
 * A Muse Image sticker being slapped on: it drops in lifted toward the
 * camera (big, tilted, long soft shadow), lands with a little bounce, a few
 * hand-drawn "thwack" strokes flick out from it, then it sways gently as if
 * one corner is still peeling - alive like the boiling ink around it.
 */
export const StickerView: React.FC<{ el: StickerElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const { frame, fps, u, palette } = ctx;
  const local = frame - el.start;
  if (local < 0) return null;

  const land = spring({ frame: local, fps, durationInFrames: Math.max(6, el.duration), config: { damping: 11, stiffness: 170, mass: 0.7 } });
  const lift = Math.max(0, 1 - land); // 1 = held up in the air, 0 = flat on the "page"
  const t = local / fps;
  const opacity = clamp01(local / Math.max(1, fps * 0.08));
  const sway = land > 0.9 ? Math.sin(t * 2.1 + (el.seed % 7)) * 1.3 : 0;
  const scale = 1 + lift * 0.42;
  const rot = el.tilt + lift * (el.tilt >= 0 ? 16 : -16) + sway;
  const cx = el.box.x + el.box.w / 2;
  const cy = el.box.y + el.box.h / 2;
  const fid = `stk-${safeId(el.id)}`;

  // Impact strokes: short dashes flicking out from two corners right as it lands.
  const hit = (local - el.duration * 0.45) / (fps * 0.45);
  let flicks: React.ReactNode = null;
  if (hit > 0 && hit < 1) {
    const r = rng(el.seed);
    const grow = clamp01(hit * 2.2);
    const fade = 1 - clamp01((hit - 0.45) / 0.55);
    const reach = Math.max(el.box.w, el.box.h) / 2;
    const paths = [-2.4, -2.0, -1.6, 0.75, 1.1, 1.45].map((a) => {
      const dir: Pt = [Math.cos(a), Math.sin(a)];
      const from = reach * 0.98 + u * 0.8;
      const to = from + u * (2.2 + r() * 1.4) * grow;
      return toPath(handLine([cx + dir[0] * from, cy + dir[1] * from], [cx + dir[0] * to, cy + dir[1] * to], r, 0.04));
    });
    flicks = paths.map((d, i) => (
      <InkPath key={i} d={d} color={palette.accents[el.color]} width={Math.max(2, u * 0.5)} ctx={ctx} opacity={fade} />
    ));
  }

  return (
    <g opacity={opacity}>
      <defs>
        <filter id={fid} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx={u * 0.2} dy={u * (0.35 + lift * 2.2)} stdDeviation={u * (0.35 + lift * 1.4)} floodColor="#000" floodOpacity={0.32 - lift * 0.12} />
        </filter>
      </defs>
      <g transform={`translate(${cx} ${cy}) rotate(${rot.toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-cx} ${-cy})`}>
        <image href={el.src} x={el.box.x} y={el.box.y} width={el.box.w} height={el.box.h} preserveAspectRatio="xMidYMid meet" filter={`url(#${fid})`} />
      </g>
      {flicks}
    </g>
  );
};

/** Holds the render until every sticker image is decoded, so no frame is captured with a blank sticker. */
export function usePreloadStickers(srcs: string[]): void {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const key = srcs.join("|");
  const [handle] = useState(() => (srcs.length > 0 ? delayRender("Decoding sticker images") : null));
  useEffect(() => {
    if (handle === null) return;
    Promise.all(
      srcs.map((src) => {
        const img = new Image();
        img.src = src;
        return img.decode();
      })
    )
      .then(() => continueRender(handle))
      .catch((err) => cancelRender(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
