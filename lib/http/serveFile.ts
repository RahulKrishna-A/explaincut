import fs from "node:fs";
import { Readable } from "node:stream";

/**
 * Streams a file from disk with HTTP Range support. Browsers need byte ranges
 * to seek inside a video (and Safari won't play an MP4 at all without them),
 * and streaming keeps large outputs out of server memory.
 */
export async function serveFile(
  request: Request,
  filePath: string,
  opts: { contentType: string; filename?: string; attachment?: boolean }
): Promise<Response> {
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": opts.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  });
  if (opts.filename) {
    headers.set("Content-Disposition", `${opts.attachment ? "attachment" : "inline"}; filename="${opts.filename}"`);
  }

  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && match && (match[1] || match[2])) {
    // "bytes=a-b", "bytes=a-" or the suffix form "bytes=-n" (last n bytes).
    let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    let end = match[1] && match[2] ? Number(match[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(0, start);
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}
