import sharp from "sharp";

/**
 * Turns a Muse Image render (a sticker on a flat key-colour background) into
 * a transparent, trimmed PNG.
 *
 * Muse Image can't return transparency, so we ask for a flat bright-green
 * backdrop and remove it here: flood-fill the background in from the image
 * border (so green *inside* the sticker - a leaf, a plant - survives), then
 * soften and un-mix the 1-2 px rim so there's no green fringe.
 */

const HARD = 85; // colour distance still counted as background by the flood fill
const SOFT = 140; // rim pixels further than this from the key are fully opaque
const OUT_MAX = 512;

export interface Cutout {
  png: Buffer;
  width: number;
  height: number;
}

export async function cutOutSticker(input: Buffer): Promise<Cutout> {
  const { data, info } = await sharp(input)
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const px = (i: number) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]] as const;

  // Key colour = median of the border pixels.
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const channel = (c: number) => border.map((i) => data[i * 3 + c]).sort((a, b) => a - b)[border.length >> 1];
  const key = [channel(0), channel(1), channel(2)];
  const dist = (i: number) => {
    const [r, g, b] = px(i);
    return Math.hypot(r - key[0], g - key[1], b - key[2]);
  };

  // A busy border means the model ignored "flat background" - no clean cutout possible.
  const flat = border.filter((i) => dist(i) < HARD).length / border.length;
  if (flat < 0.85) throw new Error(`sticker background isn't flat (${Math.round(flat * 100)}% of the border matches)`);

  // Flood fill from the border.
  const bg = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const i of border) {
    if (!bg[i] && dist(i) < HARD) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const n of next) {
      if (n >= 0 && !bg[n] && dist(n) < HARD) {
        bg[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  const bgShare = tail / (W * H);
  if (bgShare < 0.12 || bgShare > 0.95) throw new Error(`sticker cutout looks wrong (${Math.round(bgShare * 100)}% background)`);

  // Distance (in px, up to 2) from the background, for the soft rim.
  const nearBg = (i: number) => {
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && bg[ny * W + nx]) return true;
      }
    }
    return false;
  };

  const dominant = key.indexOf(Math.max(...key));
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = px(i);
    let a = 255;
    let c = [r, g, b];
    if (bg[i]) {
      a = 0;
    } else if (nearBg(i)) {
      const t = Math.max(0, Math.min(1, (dist(i) - HARD * 0.5) / (SOFT - HARD * 0.5)));
      a = Math.round(t * 255);
      // Un-mix the key colour: observed = t*fg + (1-t)*key.
      if (t > 0.02) c = c.map((v, k) => Math.max(0, Math.min(255, Math.round((v - (1 - t) * key[k]) / t))));
      // Despill: the key's dominant channel may not exceed the other two on the rim (kills the green hairline).
      const others = [0, 1, 2].filter((k) => k !== dominant).map((k) => c[k]);
      c[dominant] = Math.min(c[dominant], Math.max(...others));
    }
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = a;
  }

  const trimmed = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
    .png()
    .toBuffer();
  const png = await sharp(trimmed)
    .resize(OUT_MAX, OUT_MAX, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer({ resolveWithObject: true });
  return { png: png.data, width: png.info.width, height: png.info.height };
}
