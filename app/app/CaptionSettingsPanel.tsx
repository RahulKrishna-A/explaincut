"use client";

import {
  CAPTION_FONTS,
  CAPTION_FONT_LABELS,
  CAPTION_SIZES,
  CAPTION_SIZE_SCALE,
  type CaptionFont,
  type CaptionSettings,
} from "@/types/renderOptions";

/** Approximate on-screen previews of each caption face (the render uses the real Google Fonts). */
const PREVIEW_FAMILY: Record<CaptionFont, string> = {
  sans: '"Inter", "Helvetica Neue", Arial, sans-serif',
  rounded: 'ui-rounded, "Nunito", "Arial Rounded MT Bold", sans-serif',
  serif: '"Lora", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  hand: '"Caveat", "Comic Sans MS", cursive',
};

/** Preview type size at "medium"; small/large scale from here exactly as the render does. */
const PREVIEW_BASE_PX = 20;

const SIZE_LABEL: Record<(typeof CAPTION_SIZES)[number], string> = { small: "S", medium: "M", large: "L" };

export function CaptionSettingsPanel({
  value,
  onChange,
  disabled,
}: {
  value: CaptionSettings;
  onChange: (next: CaptionSettings) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<CaptionSettings>) => onChange({ ...value, ...patch });
  const off = disabled || !value.enabled;

  return (
    <div className="ec-panel ec-settings">
      <div className="ec-settings-head">
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Captions</div>
          <div style={{ fontSize: 13, color: "var(--muted-2)" }}>
            Burn your words into the video, in a black box at the bottom.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          aria-label="Captions"
          className="ec-switch"
          disabled={disabled}
          onClick={() => set({ enabled: !value.enabled })}
        >
          <span />
        </button>
      </div>

      <fieldset className="ec-settings-body" disabled={off} data-off={off}>
        <legend className="ec-settings-label">Font</legend>
        <div className="ec-seg" role="radiogroup" aria-label="Caption font">
          {CAPTION_FONTS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={value.font === f}
              data-on={value.font === f}
              onClick={() => set({ font: f })}
              style={{ fontFamily: PREVIEW_FAMILY[f], fontWeight: f === "hand" ? 700 : 600, fontSize: f === "hand" ? 17 : 14 }}
            >
              {CAPTION_FONT_LABELS[f]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ec-settings-label">Size</span>
            <div className="ec-seg" role="radiogroup" aria-label="Caption size">
              {CAPTION_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={value.size === s}
                  aria-label={s}
                  data-on={value.size === s}
                  onClick={() => set({ size: s })}
                  style={{ minWidth: 38 }}
                >
                  {SIZE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={value.highlightActiveWord}
              onChange={(e) => set({ highlightActiveWord: e.target.checked })}
            />
            Highlight the spoken word
          </label>
        </div>

        <div className="ec-caption-preview" aria-hidden>
          <span
            style={{
              fontFamily: PREVIEW_FAMILY[value.font],
              fontWeight: value.font === "hand" ? 700 : 800,
              fontSize: PREVIEW_BASE_PX * CAPTION_SIZE_SCALE[value.size] * (value.font === "hand" ? 1.18 : 1),
            }}
          >
            it first checks its <em style={{ fontStyle: "normal", color: value.highlightActiveWord ? "#ffd84d" : "#fff" }}>short</em> term memory
          </span>
        </div>
      </fieldset>
    </div>
  );
}
