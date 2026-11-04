<img src="public/logo.svg" width="72" height="72" alt="ExplainCut logo">

# ExplainCut

Diagrams that build themselves in sync with your words. Upload a talking-head
clip; ExplainCut transcribes it, plans a timed diagram, renders it in code, and
composites it behind you (speaker cut out via SAM 3.1) in the final video.

Built for the Meta Global AI Developer Hackathon, one day, running entirely
on Meta's Model API.

## Running locally

Prerequisites: Node 22+ and a Meta Model API key from
[dev.meta.ai](https://dev.meta.ai/docs/overview). No system FFmpeg install is
needed - `ffmpeg-static` vendors its own binary.

```bash
npm install
cp .env.example .env.local   # fill in MODEL_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Open app** (or go
straight to [/app](http://localhost:3000/app)). Choose caption settings if you
like, then drop a short (30-60s) webcam clip - processing starts as soon as the
file is picked; there's no separate Generate step.

Production build: `npm run build && npm start`. See `.env.example` for the
optional tuning vars (`SAM_CONCURRENCY`, `SPARK_FIX_DRAFTS`, `META_TIMEOUT_MS`,
`JOB_DATA_DIR`). `Dockerfile` / `fly.toml` / `railway.json` cover running it as
a long-lived container instead.

Don't have a key yet, or want to check the plumbing without spending API
calls? See [Testing without API keys](#testing-without-api-keys) below.

## The 5 AI models

Every model is reached through Meta's Model API with the same key
(`MODEL_API_KEY`, base URL `api.meta.ai/v1`). Each one has a narrow, specific
job. None of them is trusted blindly: the code checks every answer and has a
fallback if a model fails. Every call times out after 4 minutes
(`META_TIMEOUT_MS`) so a stuck request can't freeze a job.

### Muse Voice — `muse-voice-transcribe-1.0` (the ears)

**Job:** turns your speech into text and tells us exactly when each word
starts and ends. Those word times are the backbone of the whole app: every
stroke is later pinned to one of them.

- **Gets** the audio of your clip, pulled out by FFmpeg as a 16 kHz WAV file.
- **Gives back** the full transcript plus a list of words with start and end
  times.
- **Called** once per clip, in step 2. Endpoint `/asr/transcribe`.
- **If it fails** - if words come back without times, the app finds where
  you're talking with FFmpeg's silence detector and spreads the words over
  those stretches.

### SAM 3.1 — `sam-3.1` (the scissors)

**Job:** finds you in a picture. Given a still frame and the single word
"person", it returns a mask: a black-and-white image that's white where you
are and black everywhere else.

- **Gets** one still frame every 0.4 seconds of video, plus the prompt
  `person`.
- **Gives back** a 1-bit mask and its position. If it finds several people,
  the biggest one is kept.
- **Called** once per frame in step 3, six at a time. A 30-second clip is
  about 75 calls. Uses the OpenAI SDK pointed at Meta, and Meta's
  `@meta-sam/parser` to decode the stream.
- **If it fails** - it retries the frame, then uses an oval in the middle of
  the frame as a rough guess. If every frame fails, the drawing goes on top of
  you instead of behind, and the result screen says so.

### Muse Spark — `muse-spark-1.3` (the art director)

**Job:** the creative brain. It reads your words and decides what gets drawn,
in what form (a flow, a tree, a chart...), in what mood, and on which word
each stroke appears. Later, it also fixes its own plan when the reviewer
finds problems.

- **Gets** a long instruction, the transcript with every word numbered, a
  description of the empty space, and two example plans.
- **Gives back** a plan written as JSON: scenes, boxes, arrows and a timed
  list of pen actions. It never gives positions or sizes.
- **Called** step 5 to plan (up to 2 tries), and step 10 to re-plan flagged
  scenes. Endpoint `/chat/completions`.
- **If it fails** - broken output gets one retry. If that fails too, a
  built-in sample plan is spread across your real transcript, so you still
  get a video.

### Muse Image — `muse-image-1.0` (the illustrator)

**Job:** draws the stickers: small, colourful illustrations like a rocket for
"speed" or a brain for "memory" that pop onto the screen next to the diagram.

- **Gets** a prompt built from Spark's art direction, plus an art style chosen
  by the scene's tone, and a request for a flat green background.
- **Gives back** a 1024x1024 PNG. It can't make transparent images, so the
  app removes the green itself.
- **Called** step 6, three times per sticker (six if the first three are
  weak). About $0.01 per image. Endpoint `/images/generations`.
- **If it fails** - that sticker is simply left out. The rest of the video is
  unaffected.

### Muse Wonder — `muse-wonder-1.0` (the critic)

**Job:** the one model that looks at pictures and judges them. It has three
separate jobs: picking the best sticker out of three, reviewing frames of the
finished video like a picky editor, and later checking whether each problem
it raised was actually fixed.

- **Gets** images (sticker candidates or video frames) plus text: the
  transcript and a schedule of what's drawn when.
- **Gives back** scores from 0 to 10, or a list of problems with a severity
  and a suggested fix, or a fixed / not fixed verdict for each problem.
- **Called** steps 6 and 10. Uses "high" reasoning effort for reviews,
  "medium" for sticker picks. Endpoint `/responses`.
- **If it fails** - sticker picking falls back to the first candidate. The
  review still runs its exact, measured checks without it.

### Roughly how many AI calls one clip makes

| Model | What for | 30-second clip |
| --- | --- | --- |
| Muse Voice | Transcribe the audio | 1 |
| SAM 3.1 | One mask per sampled frame | ~75 |
| Muse Spark | Plan, plus one re-plan in the review | 2-4 |
| Muse Image | 3 candidates for each new sticker | 12-24 |
| Muse Wonder | Sticker picks, review, verification | ~6 |

An estimate, assuming a clip with 4 stickers, the self-review on, and some
retries. Stickers are saved by subject and tone, so a sticker the app has
drawn before costs nothing the next time.

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

