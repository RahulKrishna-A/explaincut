# ExplainCut

Diagrams that build themselves in sync with your words. Upload a talking-head
clip; ExplainCut transcribes it, plans a timed diagram, renders it in code, and
composites it behind you (speaker cut out via SAM 3.1) in the final video.

Built for the Meta Global AI Developer Hackathon, one day, running entirely
on Meta's Model API.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in MODEL_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Open app** (or go
straight to [/app](http://localhost:3000/app)). Choose caption settings if you
like, then drop a short (30-60s) webcam clip - processing starts as soon as the
file is picked; there's no separate Generate step.

Production build: `npm run build && npm start`.

## Architecture

Pipeline (`lib/pipeline.ts`): transcribe -> segment speaker -> find free space ->
plan -> lay out + schedule -> render hand-drawn layer -> composite.

- **Next.js (App Router, TypeScript)** - UI + API routes (`app/api/*`), in-memory
  job status (`lib/jobs.ts`), orchestration (`lib/pipeline.ts`).
- **Meta Model API** (`lib/meta/*.ts`) - Muse Voice Transcribe (ASR), SAM 3.1
  (speaker masks), Muse Spark (diagram plan), Muse Image (stickers), Muse Wonder
  (optional review).
  If ASR returns no word timestamps, words are laid out over the detected
  speech (ffmpeg `silencedetect`), not spread evenly.
- **Free space** (`lib/layout/freeSpace.ts`) - unions the SAM masks over the
  clip, pads them, applies a Reels/TikTok safe area and carves out the largest
  empty rectangles (above the head, left/right of the speaker). Also picks the
  `ink` (light wall) or `chalk` (dark room) palette.
- **Plan v2** (`types/diagramPlan.ts`, `lib/diagramPlan/*`) - scenes of nodes
  (shape + doodle icon), arrows and word-triggered ops: `title`, `draw`,
  `connect`, `flow`, `circle`, `underline`, `highlight`, `check`, `cross`,
  `sparkle`, `note`, `plot`. The model never gives coordinates. A scene with
  `layout: "chart"` carries a `chart` (`bar` / `line` / `pie`, data points with
  ids) instead of nodes; `plot` ops land each data point on its word.
- **Layout + timing** (`lib/layout/buildRenderPlan.ts`) - places everything
  inside the free regions. Eight scene layouts, chosen by Muse Spark per idea:
  - `flow` - steps in order; `hub` - one concept with satellites; `stack` -
    layers of a system; `cycle` - a loop; `compare` - two sides with a divider;
  - `tree` - a hierarchy, parents centred over their children;
  - `timeline` - events alternating either side of a hand-drawn time arrow;
  - `chart` - bar, line or pie/donut chart (`lib/layout/chartLayout.ts`).

  It routes arrows
  around boxes, places notes, and schedules everything on a single-pen
  timeline that starts each stroke just before its trigger word.
- **Hand-drawn renderer** (`remotion/sketch/*`) - seeded wobbly strokes drawn
  progressively with a visible pen tip (circles sweep clockwise past their
  start, boxes overshoot), hachure fills, doodle icons, handwritten text
  (Caveat) written left to right, line boil once drawn, and a wipe between
  scenes. Output is a transparent ProRes 4444 layer.
- **Stickers** (`lib/stickers/*`, `remotion/sketch/sticker.tsx`) - where a scene
  has a concrete, picturable anchor (a database, memory -> a brain, speed -> a
  rocket), Muse Spark adds one `sticker` op (max one per scene). Muse Image
  (`muse-image-1.0`, $0.01/image) draws it as a die-cut doodle sticker on flat
  green; the green is flood-filled out from the border and despilled, giving a
  transparent PNG. Stickers are cached in `data/stickers/` by subject, so the same
  subject is never paid for twice. The layout sticks the sticker on a corner of
  the node it belongs to, inside free space, and leaves it out if there's no
  room. It slaps on with a bounce and ink flicks right on its word. A failed
  sticker is simply skipped. (Muse Glimmer isn't used: it's a self-hosted,
  text-output model and can't make images.)
- **Captions** (on by default, can be switched off in the app; `lib/captions/`, `remotion/CaptionsComposition.tsx`) -
  word-timed captions in a black box near the bottom, font / size / active-word
  highlight chosen in the app. Rendered as a separate transparent layer and
  composited over the speaker; drawings keep out of the caption band.
- **ffmpeg** (`lib/ffmpeg/*.ts`) - punches the speaker out of the drawing layer
  so lines tuck behind them, and composites onto the untouched original.
- **Self-review loop** (on by default, toggle on the upload screen;
  `lib/review/`, `lib/meta/wonder.ts`, `replanScenes` in `lib/meta/spark.ts`) -
  an agent loop over the finished cut:
  1. *Watch* - measured checks (every element vs. the word that cues it; every
     element vs. the SAM 3.1 person masks) plus Muse Wonder critiquing up to
     10 sampled frames for relevance, timing and speaker overlap.
  2. *Re-plan* - Muse Spark gets its own plan plus the findings and revises
     only the flagged scenes. Each draft is laid out and measured (no render)
     and sent back once more if it still has timing/overlap problems.
  3. *Re-render* the best draft, keeping the first cut as `output-before.mp4`.
  4. *Verify* - measured checks re-run; Muse Wonder rules on each of its own
     findings against the new frames. Problems the fix introduced are reported,
     not hidden.

  The app streams each step live and shows a before/after report with frame
  thumbnails and "Jump to". A failed review never costs the first cut.

Iterate on visuals without API calls by re-rendering an existing job:

```bash
npx tsx scripts/rerender.ts <jobId> [--plan plan.json] [--regions] [--layer-only] \
  [--captions | --no-captions] [--caption-font sans|rounded|serif|mono|hand] [--caption-size small|medium|large]
```

## Testing without API keys

```bash
npm run typecheck && npm run lint && npm run smoke
```

The smoke test (`scripts/smoke-test.ts`) makes no Meta API calls:

1. Lays out every sample plan (all layouts plus charts) in portrait and
   landscape, checks every element stays inside the frame, pages captions
   and runs the self-review's measured checks.
2. Validates the flow-example plan against a fixture transcript.
3. Renders the hand-drawn layer with Remotion (ProRes 4444, real alpha).
4. If `data/fixtures/demo-clip.mp4` exists, builds speaker masks (a
   centred-ellipse mask per frame when `MODEL_API_KEY` isn't set) and runs the
   full composite. A synthetic `ffmpeg -f lavfi testsrc` clip works fine for a
   plumbing check.

## Limits

- Clips up to 2 minutes (checked before any API call) and 1 GB per upload.
- Jobs live in memory and in `data/jobs/<id>/status.json`; after a server
  restart, finished jobs load back from disk, and jobs that were mid-pipeline
  are marked as interrupted.

## Known fallbacks (by design)

- Diagram plan: bad/unparseable Muse Spark output retries once, then falls
  back to a hand-written sample plan redistributed across the real transcript.
- Segmentation: SAM 3.1 failure on any frame falls back to a centered-ellipse
  mask for that frame. If segmentation fails outright, the drawing layer is
  overlaid on the original video without cutting the speaker out (drawings may
  cover the speaker), and the result screen says so. Free space then comes from
  a default guess (above the head in portrait, beside the speaker in landscape).
- Self-review: if Muse Wonder is unavailable the measured checks still run; if
  Muse Spark's fix doesn't validate or render, the first cut is kept and the
  findings are shown as still open.

## License

ExplainCut's own source code is released under the [MIT License](LICENSE).

### Third-party software and assets

ExplainCut builds on the following. Their licenses apply to those parts, not
the MIT license above.

| Component | Used for | License |
| --- | --- | --- |
| [Remotion](https://www.remotion.dev/license) (`remotion`, `@remotion/*`) | Rendering the hand-drawn and caption layers | Remotion License - free for individuals and for-profit companies with **up to 3 employees** (and non-profits); larger companies need a paid [company license](https://www.remotion.pro/license) |
| [FFmpeg](https://ffmpeg.org/legal.html) via `ffmpeg-static` | Audio extraction, mask videos, compositing | GPL-3.0-or-later. Run as a separate executable (not linked into ExplainCut's code) |
| `@meta-sam/parser` | Parsing SAM 3.1 mask responses | [SAM License](https://github.com/facebookresearch/sam3/blob/main/LICENSE) (Meta) |
| Meta Model API (Muse Voice, SAM 3.1, Muse Spark, Muse Image, Muse Wonder) | Transcription, segmentation, planning, stickers, review | Meta's API terms - not redistributed here |
| Next.js, React, Zod, uuid, fluent-ffmpeg, Tailwind CSS | App framework, validation, utilities | MIT |
| sharp, openai (SDK) | Image processing, API client | Apache-2.0 |
| Fonts: Caveat, Inter, Nunito, Lora, JetBrains Mono, DM Sans (Google Fonts) | Handwriting, captions, UI | SIL Open Font License 1.1 |

Full license texts for each package are in its folder under `node_modules/`.

