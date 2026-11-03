import fs from "node:fs/promises";
import path from "node:path";
import { metaPostForm } from "./client";
import { extractAudio } from "@/lib/ffmpeg/extractAudio";
import { runFfmpeg } from "@/lib/ffmpeg/run";
import type { Transcript, TranscriptWord } from "@/types/transcript";

const MODEL_ID = "muse-voice-transcribe-1.0";

interface RawWordTimestamp {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  startSeconds?: number;
  endSeconds?: number;
  startMs?: number;
  endMs?: number;
}

interface RawTurn {
  words?: RawWordTimestamp[];
  text?: string;
}

interface RawTranscribeResponse {
  text?: string;
  transcript?: string;
  duration?: number;
  durationMs?: number;
  audioDurationMs?: number;
  words?: RawWordTimestamp[];
  segments?: { words?: RawWordTimestamp[] }[];
  turns?: RawTurn[];
}

function normalizeWord(raw: RawWordTimestamp): TranscriptWord {
  const word = raw.word ?? raw.text;
  const start = raw.startSeconds ?? raw.start ?? (raw.startMs !== undefined ? raw.startMs / 1000 : undefined);
  const end = raw.endSeconds ?? raw.end ?? (raw.endMs !== undefined ? raw.endMs / 1000 : undefined);
  if (word === undefined || start === undefined || end === undefined) {
    throw new Error(
      `Unrecognized word-timestamp shape from Muse Voice Transcribe: ${JSON.stringify(raw)}`
    );
  }
  return { word, startSeconds: start, endSeconds: end };
}

/** Where the person is actually talking, from ffmpeg's silence detector. */
async function detectSpeechIntervals(audioPath: string, durationSeconds: number): Promise<[number, number][]> {
  const stderr = await runFfmpeg(["-i", audioPath, "-af", "silencedetect=noise=-32dB:d=0.18", "-f", "null", "-"]);
  const silences: [number, number][] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) pendingStart = Math.max(0, Number(s[1]));
    if (e) {
      silences.push([pendingStart ?? 0, Number(e[1])]);
      pendingStart = null;
    }
  }
  if (pendingStart !== null) silences.push([pendingStart, durationSeconds]);
  const speech: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of silences) {
    if (a - cursor > 0.08) speech.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (durationSeconds - cursor > 0.08) speech.push([cursor, durationSeconds]);
  return speech;
}

/**
 * Fallback when the API returns no word-level timing. Rather than spreading
 * words evenly over the whole clip (which drifts badly across pauses), lay
 * them out only over the stretches where the speaker is actually talking,
 * each word weighted by its length.
 */
async function synthesizeWordTimestamps(text: string, durationSeconds: number, audioPath: string): Promise<TranscriptWord[]> {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let speech: [number, number][] = [];
  try {
    speech = await detectSpeechIntervals(audioPath, durationSeconds);
  } catch (err) {
    console.warn("Silence detection failed - spreading words evenly:", err);
  }
  if (speech.length === 0) speech = [[0, durationSeconds]];
  const speechTotal = speech.reduce((s, [a, b]) => s + (b - a), 0);

  /** Maps "seconds of speech so far" onto the real clock, skipping silences. */
  const toClock = (speechT: number): number => {
    let left = speechT;
    for (const [a, b] of speech) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return speech[speech.length - 1][1];
  };

  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1.5 + (/[.,!?;:]$/.test(w) ? 1.5 : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return words.map((word, i) => {
    const start = toClock((acc / totalWeight) * speechTotal);
    acc += weights[i];
    const end = toClock((acc / totalWeight) * speechTotal);
    return { word, startSeconds: start, endSeconds: Math.max(start + 0.05, end) };
  });
}

/**
 * Calls Muse Voice Transcribe with a pre-recorded video's audio track. The
 * endpoint requires a "request" (JSON metadata) part plus a separate "audio"
 * part - confirmed against the real API's error message, which rejected a
 * single "model"+"file" shape. Response word-timestamp shape is still a
 * best guess; this normalizes a couple of plausible shapes and throws a
 * descriptive error otherwise so it's fast to patch against the real response.
 */
export async function transcribeVideo(videoPath: string): Promise<Transcript> {
  const audioPath = path.join(path.dirname(videoPath), "audio-for-transcribe.wav");
  await extractAudio(videoPath, audioPath);
  const audioBuffer = await fs.readFile(audioPath);

  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      model: MODEL_ID,
      audioEncoding: "WAV",
      sampleRateHertz: 16000,
      wordTimestamps: true,
      enableWordTimeOffsets: true,
      timestampGranularity: "word",
    })
  );
  form.append("audio", new Blob([new Uint8Array(audioBuffer)]), "audio.wav");

  const raw = (await metaPostForm("/asr/transcribe", form)) as RawTranscribeResponse;
  // Keep the untouched response next to the job - makes it quick to adapt
  // normalizeWord() if the API's word-timestamp shape differs from our guess.
  await fs.writeFile(path.join(path.dirname(videoPath), "transcript-raw.json"), JSON.stringify(raw, null, 2)).catch(() => {});

  const text = raw.text ?? raw.transcript ?? "";
  const durationSeconds =
    raw.duration ??
    (raw.durationMs !== undefined ? raw.durationMs / 1000 : undefined) ??
    (raw.audioDurationMs !== undefined ? raw.audioDurationMs / 1000 : undefined);

  const flatWords =
    raw.words ??
    raw.segments?.flatMap((s) => s.words ?? []) ??
    raw.turns?.flatMap((t) => t.words ?? []) ??
    [];

  if (flatWords.length === 0) {
    if (!text || durationSeconds === undefined) {
      throw new Error(
        `Muse Voice Transcribe returned no usable transcript: ${JSON.stringify(raw).slice(0, 500)}`
      );
    }
    console.warn(
      "Muse Voice Transcribe returned no word-level timestamps - synthesizing them from detected speech."
    );
    const words = await synthesizeWordTimestamps(text, durationSeconds, audioPath);
    return { text, words, durationSeconds };
  }

  const words = flatWords.map(normalizeWord);
  return {
    text: text || words.map((w) => w.word).join(" "),
    words,
    durationSeconds: durationSeconds ?? words[words.length - 1].endSeconds,
  };
}
