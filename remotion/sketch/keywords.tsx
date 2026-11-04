import React from "react";
import { spring } from "remotion";
import type { KeywordElement } from "@/types/diagramPlan";
import { clamp01, type DrawCtx } from "./elements";
import { heavyFontFamily } from "../fonts";

/**
 * A spoken word, set huge behind the speaker. It punches in (big -> settled, with a
 * little overshoot), holds, then drops away. The compositor later hides the part of
 * the letters the speaker's head covers - that overlap is the whole effect.
 */
export const KeywordView: React.FC<{ el: KeywordElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const { frame, fps, u } = ctx;
  const local = frame - el.start;
  if (local < 0 || local > el.duration) return null;
  const pop = spring({ frame: local, fps, durationInFrames: 10, config: { damping: 12, stiffness: 220, mass: 0.6 } });
  const out = clamp01((el.duration - local) / 5);
  const scale = (1.28 - 0.28 * pop) * (0.94 + 0.06 * out);
  const opacity = clamp01(local / 3) * out;
  const f = el.fontSize;
  return (
    <g opacity={opacity} transform={`translate(${el.cx} ${el.cy}) scale(${scale.toFixed(4)}) translate(${-el.cx} ${-el.cy})`}>
      <text
        x={el.cx}
        y={el.cy + f * 0.36}
        textAnchor="middle"
        fontFamily={heavyFontFamily}
        fontWeight={900}
        fontSize={f}
        letterSpacing={f * -0.01}
        fill="#ffe600"
        stroke="#000"
        strokeWidth={Math.max(u * 0.9, f * 0.09)}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ filter: `drop-shadow(0 ${u * 0.5}px ${u * 0.8}px rgba(0,0,0,0.55))` }}
      >
        {el.text}
      </text>
    </g>
  );
};
