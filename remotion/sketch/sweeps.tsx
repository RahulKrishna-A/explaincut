import React from "react";
import type { SweepElement } from "@/types/diagramPlan";
import { clamp01, safeId, type DrawCtx } from "./elements";
import { toPath, type Pt } from "./rough";

/** Fraction of the crossing the trail stays visible for after the tool has passed. */
const TRAIL = 0.42;

const at = (path: SweepElement["path"], t: number): Pt => {
  const f = clamp01(t) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(f));
  const k = f - i;
  return [path[i].x + (path[i + 1].x - path[i].x) * k, path[i].y + (path[i + 1].y - path[i].y) * k];
};

const slice = (path: SweepElement["path"], a: number, b: number): Pt[] => {
  const out: Pt[] = [at(path, a)];
  const n = path.length - 1;
  for (let i = Math.ceil(a * n); i <= Math.floor(b * n); i++) if (i / n > a && i / n < b) out.push([path[i].x, path[i].y]);
  out.push(at(path, b));
  return out;
};

/**
 * A tool travelling across the frame: marker scribble, eraser wipe or
 * highlighter swipe. The head leads, the trail fades from the tail forward.
 * Anything under the speaker is cut away later by the mask, so it vanishes
 * behind them and the tool reappears on the far side.
 */
export const SweepView: React.FC<{ el: SweepElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const { frame, palette, u } = ctx;
  const local = frame - el.start;
  if (local < 0 || local > el.duration * (1 + TRAIL) + 2) return null;
  const head = clamp01(local / el.duration);
  const eased = head * 0.6 + (0.5 - 0.5 * Math.cos(Math.PI * head)) * 0.4;
  // The tail follows behind the head, so the trail is a moving window.
  const tailT = clamp01((local - el.duration * 0.05) / (el.duration * (1 + TRAIL)));
  const tail = Math.max(0, tailT * tailT * 1.0 - 0.0);
  const a = Math.min(eased, Math.min(1, tail));
  const color = palette.accents[el.color];
  const id = `sw-${safeId(el.id)}`;
  const pts = slice(el.path, a, eased);
  if (pts.length < 2) return null;
  const d = toPath(pts);
  const tip = at(el.path, eased);
  const ahead = at(el.path, Math.min(1, eased + 0.02));
  const angle = Math.atan2(ahead[1] - tip[1], ahead[0] - tip[0]);

  if (el.variant === "highlighter") {
    return (
      <g opacity={0.82}>
        <path d={d} fill="none" stroke={color} strokeWidth={el.thickness} strokeLinecap="square" style={{ mixBlendMode: "multiply" }} opacity={0.75} />
        {head < 1 ? <rect x={tip[0] - u * 1.2} y={tip[1] - el.thickness * 0.6} width={u * 2.4} height={el.thickness * 1.2} rx={u * 0.5} fill={color} stroke={palette.ink} strokeWidth={u * 0.3} /> : null}
      </g>
    );
  }
  if (el.variant === "eraser") {
    return (
      <g>
        <defs>
          <filter id={id} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation={u * 0.5} />
          </filter>
        </defs>
        <path d={d} fill="none" stroke={palette.paper} strokeWidth={el.thickness} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} filter={`url(#${id})`} />
        <path d={d} fill="none" stroke={palette.ink} strokeWidth={u * 0.25} strokeLinecap="round" opacity={0.18} strokeDasharray={`${u * 0.8} ${u * 1.6}`} />
        {head < 1 ? (
          <g transform={`translate(${tip[0]} ${tip[1]}) rotate(${((angle * 180) / Math.PI).toFixed(1)})`}>
            <rect x={-u * 4.2} y={-u * 2.6} width={u * 8.4} height={u * 5.2} rx={u * 1.1} fill="#f6a1b8" stroke={palette.ink} strokeWidth={u * 0.35} />
            <rect x={-u * 4.2} y={-u * 2.6} width={u * 3.4} height={u * 5.2} rx={u * 1.1} fill="#7aa7e8" stroke={palette.ink} strokeWidth={u * 0.35} />
          </g>
        ) : null}
      </g>
    );
  }
  // scribble
  return (
    <g>
      <path d={d} fill="none" stroke={palette.halo} strokeWidth={el.thickness + u * 0.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <path d={d} fill="none" stroke={color} strokeWidth={el.thickness} strokeLinecap="round" strokeLinejoin="round" />
      {head < 1 ? <circle cx={tip[0]} cy={tip[1]} r={u * 1.4} fill={color} stroke={palette.ink} strokeWidth={u * 0.3} /> : null}
    </g>
  );
};
