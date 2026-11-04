import React, { useEffect, useState } from "react";
import { spring, useDelayRender } from "remotion";
import type { StickerElement } from "@/types/diagramPlan";
import { InkPath, clamp01, safeId, smooth, type DrawCtx } from "./elements";
import { handLine, rng, toPath, type Pt } from "./rough";

/**
 * A Muse Image sticker that behaves like a real vinyl sticker.
 *
 *  - ENTRANCE (from the scene's tone): "pop" springs in with a wobble and a
 *    burst of sparks; "slap" drops in lifted and lands with a bounce;
 *    "stamp" slams down with a squash and a shake; "peel" is laid down from
 *    one corner, its white backing curling over at the fold.
 *  - MATERIAL: light plays across its surface - a holographic rainbow sheen,
 *    a gold glint with twinkles, a gloss highlight, matte print grain or
 *    paper texture - always clipped to the sticker's own silhouette. A glint
 *    sweeps across as it lands and again every few seconds.
 *  - EXIT: it lifts off and floats away just before the scene clears.
 */

interface Pose {
  scale: number;
  sx: number;
  sy: number;
  rot: number;
  dx: number;
  dy: number;
  /** 1 = held up off the page (big soft shadow), 0 = flat. */
  lift: number;
  opacity: number;
  /** Peel entrance only: 0 = nothing laid down yet, 1 = fully stuck. */
  peel: number;
  /** Frame (relative to start) it lands - the glint and impact effects key off this. */
  landAt: number;
}

const decay = (t: number, rate: number) => Math.exp(-t * rate);

function entrancePose(el: StickerElement, local: number, fps: number, u: number): Pose {
  const dur = Math.max(6, el.duration);
  const base: Pose = { scale: 1, sx: 1, sy: 1, rot: el.tilt, dx: 0, dy: 0, lift: 0, opacity: 1, peel: 1, landAt: dur * 0.5 };
  switch (el.entrance) {
    case "pop": {
      // Springs up from nothing past full size, wobbling as it settles.
      const s = spring({ frame: local, fps, durationInFrames: dur, config: { damping: 9, stiffness: 210, mass: 0.6 } });
      const t = local / fps;
      return {
        ...base,
        scale: 0.1 + 0.9 * s,
        rot: el.tilt + (1 - Math.min(1, s)) * -22 + Math.sin(t * 22) * 7 * decay(t, 6),
        lift: Math.max(0, 1 - s) * 0.8,
        opacity: clamp01(local / Math.max(1, fps * 0.06)),
        landAt: dur * 0.35,
      };
    }
    case "stamp": {
      // Falls toward the page, accelerating, then slams: squash + shake.
      const hitAt = dur * 0.55;
      if (local < hitAt) {
        const a = local / hitAt;
        const fall = a * a * a;
        return { ...base, scale: 1.9 - 0.9 * fall, rot: el.tilt - 9 * (1 - fall), lift: 1 - fall, opacity: clamp01(a * 3), landAt: hitAt };
      }
      const t = (local - hitAt) / fps;
      const squash = 0.11 * decay(t, 18);
      return {
        ...base,
        sx: 1 + squash,
        sy: 1 - squash,
        dx: Math.sin(t * 95) * u * 0.7 * decay(t, 14),
        dy: Math.cos(t * 80) * u * 0.35 * decay(t, 14),
        landAt: hitAt,
      };
    }
    case "peel":
      // Laid down corner-first; a gentle ease so the fold glides across.
      return { ...base, peel: smooth(clamp01(local / dur)), landAt: dur };
    default: {
      // Slap: drops in lifted toward the camera, lands with a bounce.
      const land = spring({ frame: local, fps, durationInFrames: dur, config: { damping: 11, stiffness: 170, mass: 0.7 } });
      const lift = Math.max(0, 1 - land);
      return {
        ...base,
        scale: 1 + lift * 0.42,
        rot: el.tilt + lift * (el.tilt >= 0 ? 16 : -16),
        lift,
        opacity: clamp01(local / Math.max(1, fps * 0.08)),
        landAt: dur * 0.45,
      };
    }
  }
}

/** Short ink strokes flicking out as it lands (slap/stamp: two corners; pop: all round). */
function impactStrokes(el: StickerElement, ctx: DrawCtx, sinceLand: number): React.ReactNode {
  const { fps, u, palette } = ctx;
  if (el.entrance === "peel") return null;
  const hit = sinceLand / (fps * 0.45);
  if (hit <= 0 || hit >= 1) return null;
  const r = rng(el.seed);
  const grow = clamp01(hit * 2.2);
  const fade = 1 - clamp01((hit - 0.45) / 0.55);
  const cx = el.box.x + el.box.w / 2;
  const cy = el.box.y + el.box.h / 2;
  const reach = Math.max(el.box.w, el.box.h) / 2;
  const angles = el.entrance === "pop" ? Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2 + 0.3) : [-2.4, -2.0, -1.6, 0.75, 1.1, 1.45];
  const color = palette.accents[el.entrance === "stamp" ? "pink" : el.color];
  return angles.map((a, i) => {
    const dir: Pt = [Math.cos(a), Math.sin(a)];
    const from = reach * 0.98 + u * 0.8;
    const to = from + u * (2.2 + r() * 1.4) * grow;
    const d = toPath(handLine([cx + dir[0] * from, cy + dir[1] * from], [cx + dir[0] * to, cy + dir[1] * to], r, 0.04));
    return <InkPath key={i} d={d} color={color} width={Math.max(2, u * 0.5)} ctx={ctx} opacity={fade} />;
  });
}

/** A four-point twinkle. */
function Twinkle({ x, y, size, opacity }: { x: number; y: number; size: number; opacity: number }) {
  if (opacity <= 0.01) return null;
  const s = size;
  const k = s * 0.22;
  return (
    <path
      d={`M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z`}
      fill="#fffbe8"
      opacity={opacity}
    />
  );
}

/**
 * Light on the sticker's surface, clipped to its silhouette by `maskId`.
 * `glint` is 0..1 progress of a diagonal light sweep (or -1 when none).
 */
function Material({ el, ctx, maskId, glint, t }: { el: StickerElement; ctx: DrawCtx; maskId: string; glint: number; t: number }) {
  const { box } = el;
  const id = safeId(el.id);
  const diag = Math.hypot(box.w, box.h);
  // Band travels along the top-left -> bottom-right diagonal.
  const bandX = box.x - diag * 0.5 + glint * (box.w + diag);
  const band = (color: string, width: number, opacity: number) =>
    glint >= 0 ? (
      <rect
        x={bandX - width / 2}
        y={box.y - diag}
        width={width}
        height={diag * 3}
        fill={`url(#${id}-band-${color.replace("#", "")})`}
        opacity={opacity}
        transform={`rotate(-28 ${bandX} ${box.y + box.h / 2})`}
      />
    ) : null;
  const bandGradient = (color: string) => (
    <linearGradient id={`${id}-band-${color.replace("#", "")}`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor={color} stopOpacity="0" />
      <stop offset="0.5" stopColor={color} stopOpacity="1" />
      <stop offset="1" stopColor={color} stopOpacity="0" />
    </linearGradient>
  );
  // A soft highlight in the top-left, like a light above the camera.
  const gloss = (opacity: number) => (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={`url(#${id}-gloss)`} opacity={opacity} />
  );

  let surface: React.ReactNode = null;
  switch (el.material) {
    case "holo": {
      // Iridescent film whose colours drift as the sticker sways, plus a bright glint.
      const shift = (t * 0.18) % 1;
      surface = (
        <>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={`url(#${id}-holo)`} opacity={0.3} style={{ mixBlendMode: "overlay" }} />
          <rect
            x={box.x - box.w * shift}
            y={box.y}
            width={box.w * 2}
            height={box.h}
            fill={`url(#${id}-holo)`}
            opacity={0.16}
            style={{ mixBlendMode: "color-dodge" }}
          />
          {gloss(0.45)}
          {band("#ffffff", diag * 0.16, 0.85)}
        </>
      );
      break;
    }
    case "gold":
      surface = (
        <>
          {gloss(0.35)}
          {band("#fff4cc", diag * 0.2, 0.9)}
        </>
      );
      break;
    case "gloss":
      surface = (
        <>
          {gloss(0.38)}
          {band("#ffffff", diag * 0.14, 0.6)}
        </>
      );
      break;
    case "matte":
      surface = (
        <>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} filter={`url(#${id}-grain)`} opacity={0.16} />
          {band("#ffffff", diag * 0.18, 0.18)}
        </>
      );
      break;
    case "paper":
      surface = (
        <>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} filter={`url(#${id}-grain)`} opacity={0.13} />
          {gloss(0.12)}
        </>
      );
      break;
  }

  return (
    <>
      <defs>
        <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.38" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-holo`} x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect">
          {["#ff7ad9", "#ffd36e", "#8affc1", "#6fd6ff", "#b48cff", "#ff7ad9"].map((c, i) => (
            <stop key={i} offset={i / 5} stopColor={c} />
          ))}
        </linearGradient>
        {bandGradient("#ffffff")}
        {bandGradient("#fff4cc")}
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={1.6 / Math.max(1, ctx.u)} numOctaves={2} seed={el.seed % 997} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <g mask={`url(#${maskId})`} style={{ isolation: "isolate" }}>
        {surface}
      </g>
    </>
  );
}

/** Strip between two lines perpendicular to `d` (at distances f0 < f1 from `o`), long enough to cross the sticker. */
function band(o: { x: number; y: number }, d: { x: number; y: number }, f0: number, f1: number, size: number): string {
  const n = { x: -d.y, y: d.x };
  const at = (f: number, s: number) => [o.x + d.x * f + n.x * size * s, o.y + d.y * f + n.y * size * s];
  return [at(f0, 1), at(f0, -1), at(f1, -1), at(f1, 1)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** Half-plane polygon on one side of the peel's fold line, big enough to cover the sticker. */
function halfPlane(o: { x: number; y: number }, d: { x: number; y: number }, f: number, side: 1 | -1, size: number): string {
  const p0 = { x: o.x + d.x * f, y: o.y + d.y * f };
  const n = { x: -d.y, y: d.x };
  const pts = [
    [p0.x + n.x * size, p0.y + n.y * size],
    [p0.x - n.x * size, p0.y - n.y * size],
    [p0.x - n.x * size + d.x * size * side, p0.y - n.y * size + d.y * size * side],
    [p0.x + n.x * size + d.x * size * side, p0.y + n.y * size + d.y * size * side],
  ];
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export const StickerView: React.FC<{ el: StickerElement; ctx: DrawCtx }> = ({ el, ctx }) => {
  const { frame, fps, u } = ctx;
  const local = frame - el.start;
  if (local < 0) return null;

  const pose = entrancePose(el, local, fps, u);
  const t = local / fps;
  const sinceLand = local - pose.landAt;

  // Exit: lifts off the page and floats away as the scene clears.
  const ex = smooth(clamp01((frame - el.exitAt) / (fps * 0.35)));
  // Idle: a slow organic sway once it's down (two detuned sines, never perfectly periodic).
  const settled = clamp01(sinceLand / (fps * 0.4));
  const sway = settled * (Math.sin(t * 1.9 + (el.seed % 7)) * 1.1 + Math.sin(t * 0.83 + (el.seed % 5)) * 0.7);

  const lift = Math.max(pose.lift, ex);
  const scale = pose.scale * (1 + ex * 0.14);
  const rot = pose.rot + sway + ex * (el.tilt >= 0 ? 9 : -9);
  const dy = pose.dy - ex * u * 4;
  const opacity = pose.opacity * (1 - ex);
  if (opacity <= 0.001) return null;

  const { box } = el;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const id = safeId(el.id);

  // Glint: once as it lands, then again every ~4.5 s while it sits there.
  const SWEEP = fps * 0.65;
  const firstGlint = sinceLand >= 0 && sinceLand < SWEEP ? sinceLand / SWEEP : -1;
  const idle = sinceLand - SWEEP - fps * 1.5;
  const period = fps * 4.5;
  const repeatGlint = idle > 0 && idle % period < SWEEP ? (idle % period) / SWEEP : -1;
  const glint = firstGlint >= 0 ? smooth(firstGlint) : repeatGlint >= 0 ? smooth(repeatGlint) : -1;

  // Peel geometry (box-local, before rotation): the fold travels along the diagonal from the top-left corner.
  const peeling = el.entrance === "peel" && pose.peel < 1;
  const diagLen = Math.hypot(box.w, box.h);
  const dir = { x: box.w / diagLen, y: box.h / diagLen };
  const span = box.w * dir.x + box.h * dir.y;
  const fold = pose.peel * span;
  const origin = { x: box.x, y: box.y };
  // Only a narrow lip just past the fold is lifted and curls back over it (shrinking as the peel
  // finishes); the rest of the not-yet-laid sticker isn't shown. The lip is that strip reflected
  // over the fold line and foreshortened - the white backing seen as it curls toward the camera.
  const curl = Math.min(span - fold, span * 0.2 * (1 - pose.peel * 0.5));
  const k = 0.55;
  const m = {
    a: 1 - (1 + k) * dir.x * dir.x,
    b: -(1 + k) * dir.x * dir.y,
    c: -(1 + k) * dir.x * dir.y,
    d: 1 - (1 + k) * dir.y * dir.y,
    e: (1 + k) * (origin.x * dir.x + origin.y * dir.y + fold) * dir.x,
    f: (1 + k) * (origin.x * dir.x + origin.y * dir.y + fold) * dir.y,
  };

  const image = (extra?: { filter?: string }) => (
    <image href={el.src} x={box.x} y={box.y} width={box.w} height={box.h} preserveAspectRatio="xMidYMid meet" {...extra} />
  );

  // Twinkles for gold, a couple of glints for holo - placed inside the sticker, seeded.
  let twinkles: React.ReactNode = null;
  if ((el.material === "gold" || el.material === "holo") && sinceLand > 0) {
    const r = rng(el.seed + 17);
    twinkles = Array.from({ length: el.material === "gold" ? 4 : 2 }, (_, i) => {
      const px = box.x + box.w * (0.18 + r() * 0.64);
      const py = box.y + box.h * (0.15 + r() * 0.6);
      const phase = r() * Math.PI * 2;
      const tw = Math.max(0, Math.sin(t * (2.6 + i * 0.7) + phase));
      return <Twinkle key={i} x={px} y={py} size={u * (0.9 + r() * 0.8) * (0.4 + 0.6 * tw)} opacity={tw ** 3 * 0.95} />;
    });
  }

  const content = (
    <>
      {image({ filter: `url(#${id}-shadow)` })}
      <Material el={el} ctx={ctx} maskId={`${id}-mask`} glint={glint} t={t} />
      {twinkles}
    </>
  );

  return (
    <g opacity={opacity}>
      <defs>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx={u * 0.2} dy={u * (0.35 + lift * 2.2)} stdDeviation={u * (0.35 + lift * 1.4)} floodColor="#000" floodOpacity={0.32 - lift * 0.12} />
        </filter>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }}>
          {image()}
        </mask>
        {peeling ? (
          <>
            <clipPath id={`${id}-stuck`}>
              <polygon points={halfPlane(origin, dir, fold, -1, diagLen * 2)} />
            </clipPath>
            <clipPath id={`${id}-loose`}>
              <polygon points={band(origin, dir, fold, fold + curl, diagLen * 2)} />
            </clipPath>
            <linearGradient
              id={`${id}-foldshade`}
              gradientUnits="userSpaceOnUse"
              x1={origin.x + dir.x * (fold - curl * k - u * 1.4)}
              y1={origin.y + dir.y * (fold - curl * k - u * 1.4)}
              x2={origin.x + dir.x * fold}
              y2={origin.y + dir.y * fold}
            >
              <stop offset="0" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.32" />
            </linearGradient>
            {/* The sticker's back: its silhouette in white backing paper, shaded and casting a shadow. */}
            <filter id={`${id}-back`} x="-30%" y="-30%" width="160%" height="160%">
              <feFlood floodColor="#f3f1ec" result="paper" />
              <feComposite in="paper" in2="SourceAlpha" operator="in" result="back" />
              <feDropShadow in="back" dx={u * 0.15} dy={u * 0.5} stdDeviation={u * 0.6} floodColor="#000" floodOpacity={0.28} />
            </filter>
          </>
        ) : null}
      </defs>
      <g
        transform={`translate(${cx + pose.dx} ${cy + dy}) rotate(${rot.toFixed(2)}) scale(${(scale * pose.sx).toFixed(4)} ${(scale * pose.sy).toFixed(4)}) translate(${-cx} ${-cy})`}
      >
        {peeling ? (
          <>
            <g clipPath={`url(#${id}-stuck)`}>
              {content}
              {/* Soft shadow the lifted lip casts just behind the fold. */}
              <polygon points={band(origin, dir, fold - curl * k - u * 1.4, fold, diagLen * 2)} fill={`url(#${id}-foldshade)`} mask={`url(#${id}-mask)`} />
            </g>
            <g transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}>
              <g clipPath={`url(#${id}-loose)`}>{image({ filter: `url(#${id}-back)` })}</g>
            </g>
          </>
        ) : (
          content
        )}
      </g>
      {ex < 0.05 ? impactStrokes(el, ctx, sinceLand) : null}
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

