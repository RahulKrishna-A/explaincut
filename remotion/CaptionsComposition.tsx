import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, type CalculateMetadataFunction } from "remotion";
import type { TranscriptWord } from "@/types/transcript";
import { DEFAULT_RENDER_OPTIONS, type CaptionSettings } from "@/types/renderOptions";
import { buildCaptionPages, captionMetrics } from "@/lib/captions/buildCaptions";
import { captionFontFamily } from "./captionFonts";
import demoTranscript from "@/data/fixtures/demo-transcript.json";

export type CaptionsProps = {
  words: TranscriptWord[];
  settings: CaptionSettings;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
} & Record<string, unknown>;

export const captionsDefaultProps: CaptionsProps = {
  words: (demoTranscript as { words: TranscriptWord[] }).words,
  settings: { ...DEFAULT_RENDER_OPTIONS.captions, enabled: true },
  width: 1080,
  height: 1920,
  fps: 30,
  durationSeconds: (demoTranscript as { durationSeconds: number }).durationSeconds,
};

export const calculateCaptionsMetadata: CalculateMetadataFunction<CaptionsProps> = ({ props }) => ({
  durationInFrames: Math.max(1, Math.round(props.durationSeconds * props.fps)),
  fps: props.fps,
  width: props.width,
  height: props.height,
});

const HIGHLIGHT = "#ffd84d";
const POP_FRAMES = 4;

/**
 * Burned-in captions on a transparent background: one short "page" of words
 * at a time in a black rounded box near the bottom, with the word being
 * spoken lit up. Composited OVER the speaker (after the drawing layer's
 * punch-out), so the person never hides them.
 */
export const CaptionsComposition: React.FC<CaptionsProps> = ({ words, settings }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = useMemo(() => captionMetrics(width, height, settings), [width, height, settings]);
  const pages = useMemo(() => buildCaptionPages(words, metrics, settings.font), [words, metrics, settings.font]);
  const fontFamily = captionFontFamily(settings.font);

  const t = frame / fps;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return <AbsoluteFill />;

  const local = frame - Math.round(page.start * fps);
  const appear = interpolate(local, [0, POP_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exitFrames = Math.round(page.end * fps) - frame;
  const fadeOut = interpolate(exitFrames, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: metrics.bottomMargin,
          display: "flex",
          justifyContent: "center",
          opacity: appear * fadeOut,
          transform: `translateY(${(1 - appear) * metrics.fontSize * 0.25}px) scale(${0.96 + 0.04 * appear})`,
          transformOrigin: "50% 100%",
        }}
      >
        <div
          style={{
            maxWidth: metrics.maxTextWidth + metrics.padX * 2,
            padding: `${metrics.padY}px ${metrics.padX}px`,
            background: "rgba(0, 0, 0, 0.82)",
            borderRadius: metrics.fontSize * 0.36,
            color: "#ffffff",
            fontFamily,
            fontWeight: settings.font === "serif" || settings.font === "hand" ? 700 : 800,
            fontSize: metrics.fontSize,
            lineHeight: `${metrics.lineHeight}px`,
            letterSpacing: settings.font === "mono" ? "-0.02em" : "-0.005em",
            textAlign: "center",
            overflowWrap: "break-word",
          }}
        >
          {page.words.map((w, i) => {
            const active = settings.highlightActiveWord && t >= w.start && t < (page.words[i + 1]?.start ?? page.end);
            return (
              <React.Fragment key={i}>
                {i > 0 ? " " : null}
                <span style={{ color: active ? HIGHLIGHT : "#ffffff" }}>{w.text}</span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
