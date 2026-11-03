import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform.");
}

const FFMPEG_BIN = ffmpegPath as string;

export function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, { maxBuffer: 1024 * 1024 * 64 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg failed (${args.join(" ")}):\n${stderr}`));
        return;
      }
      resolve(stderr);
    });
  });
}

/** Parses "Duration: HH:MM:SS.xx" out of ffmpeg's own stderr banner - avoids an ffprobe dependency. */
export async function getDurationSeconds(inputPath: string): Promise<number> {
  let stderr = "";
  try {
    stderr = await runFfmpeg(["-i", inputPath]);
  } catch (err) {
    // ffmpeg exits non-zero with just `-i` and no output - the banner (and the
    // error we want) is still on stderr, captured via the rejected error message.
    stderr = (err as Error).message;
  }
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`Could not parse duration from ffmpeg output for ${inputPath}`);
  }
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Parses "1280x720" out of ffmpeg's "Video: h264 ... 1280x720" stderr banner line. */
export async function getVideoDimensions(
  inputPath: string
): Promise<{ width: number; height: number }> {
  let stderr = "";
  try {
    stderr = await runFfmpeg(["-i", inputPath]);
  } catch (err) {
    stderr = (err as Error).message;
  }
  const match = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!match) {
    throw new Error(`Could not parse video dimensions from ffmpeg output for ${inputPath}`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}
