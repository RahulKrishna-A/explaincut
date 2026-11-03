import { runFfmpeg } from "./run";

/** Extracts a 16kHz mono PCM WAV track - a safe, widely-accepted ASR input format. */
export async function extractAudio(videoPath: string, outputWavPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputWavPath,
  ]);
}
