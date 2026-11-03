const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";

function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    throw new Error(
      "MODEL_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
  return key;
}

async function parseOrThrow(res: Response, context: string): Promise<unknown> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta Model API ${context} failed: ${res.status} ${res.statusText} - ${body}`);
  }
  return res.json();
}

/** POST a JSON body to the Meta Model API (e.g. /v1/responses). */
export async function metaPostJSON(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseOrThrow(res, path);
}

/** POST a multipart/form-data body (e.g. /v1/files, /v1/asr/transcribe). */
export async function metaPostForm(path: string, form: FormData): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  return parseOrThrow(res, path);
}

export async function metaGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  return parseOrThrow(res, path);
}
