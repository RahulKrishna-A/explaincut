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

Open [http://localhost:3000](http://localhost:3000), upload a short (30-60s)
webcam clip, click Generate.

## Architecture

Pipeline (`lib/pipeline.ts`): transcribe -> segment speaker -> find free space ->
plan -> lay out + schedule -> render hand-drawn layer -> composite.

- **Next.js (App Router, TypeScript)** - UI + API routes (`app/api/*`), in-memory
  job status (`lib/jobs.ts`), orchestration (`lib/pipeline.ts`).
- **Meta Model API** (`lib/meta/*.ts`) - Muse Voice Transcribe (ASR), SAM 3.1
  (speaker masks), Muse Spark (diagram plan), Muse Wonder (optional review).
  If ASR returns no word timestamps, words are laid out over the detected
  speech (ffmpeg `silencedetect`), not spread evenly.
- **Free space** (`lib/layout/freeSpace.ts`) - unions the SAM masks over the
  clip, pads them, applies a Reels/TikTok safe area and carves out the largest
  empty rectangles (above the head, left/right of the speaker). Also picks the
  `ink` (light wall) or `chalk` (dark room) palette.
- **Plan v2** (`types/diagramPlan.ts`, `lib/diagramPlan/*`) - scenes of nodes
  (shape + doodle icon), arrows and word-triggered ops: `title`, `draw`,
  `connect`, `flow`, `circle`, `underline`, `highlight`, `check`, `cross`,
  `sparkle`, `note`. The model never gives coordinates.
- **Layout + timing** (`lib/layout/buildRenderPlan.ts`) - places nodes inside
  the free regions (flow / hub / stack / cycle / compare), routes arrows
  around boxes, places notes, and schedules everything on a single-pen
  timeline that starts each stroke just before its trigger word.
- **Hand-drawn renderer** (`remotion/sketch/*`) - seeded wobbly strokes drawn
  progressively with a visible pen tip (circles sweep clockwise past their
  start, boxes overshoot), hachure fills, doodle icons, handwritten text
  (Caveat) written left to right, line boil once drawn, and a wipe between
  scenes. Output is a transparent ProRes 4444 layer.
- **ffmpeg** (`lib/ffmpeg/*.ts`) - punches the speaker out of the drawing layer
  so lines tuck behind them, and composites onto the untouched original.

Iterate on visuals without API calls by re-rendering an existing job:

```bash
npx tsx scripts/rerender.ts <jobId> [--plan plan.json] [--regions] [--layer-only]
```

## Testing without API keys

```bash
npx tsx scripts/smoke-test.ts
```

Validates the diagram-plan schema, Remotion rendering, and the full ffmpeg
compositing chain using fixtures (`data/fixtures/`) - no Meta API calls
required. The segmentation step gracefully falls back to a centered-ellipse
mask when `MODEL_API_KEY` isn't set, so the compositing machinery is fully
exercised even before real credentials are available. Drop a short clip at
`data/fixtures/demo-clip.mp4` to test against a real video (a synthetic
`ffmpeg -f lavfi testsrc` clip works fine for a plumbing check).

## Known fallbacks (by design)

- Diagram plan: bad/unparseable Muse Spark output retries once, then falls
  back to a hand-written sample plan redistributed across the real transcript.
- Segmentation: SAM 3.1 failure on any frame falls back to a centered-ellipse
  mask for that frame; if masking fails outright, the whole job falls back to
  a side-by-side (speaker | diagram) layout instead of true cutout.
- Muse Wonder review is off by default (`ENABLE_WONDER_REVIEW=true` to enable)
  and never blocks the core render/download flow on failure.
