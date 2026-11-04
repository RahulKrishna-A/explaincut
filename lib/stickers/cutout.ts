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
const OUT_MAX = 768;
/** Die-cut border thickness, as a fraction of the sticker's longer side. */
const BORDER = 0.045;

export interface Cutout {
  png: Buffer;
  width: number;
  height: number;
}

export async function cutOutSticker(input: Buffer): Promise<Cutout> {
  const { data, info } = await sharp(input)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const px = (i: number) =>
    [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]] as const;

  // Key colour = median of the border pixels.
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const channel = (c: number) =>
    border.map((i) => data[i * 3 + c]).sort((a, b) => a - b)[
      border.length >> 1
    ];
  const key = [channel(0), channel(1), channel(2)];
  const dist = (i: number) => {
    const [r, g, b] = px(i);
    return Math.hypot(r - key[0], g - key[1], b - key[2]);
  };

  // A busy border means the model ignored "flat background" - no clean cutout possible.
  const flat = border.filter((i) => dist(i) < HARD).length / border.length;
  if (flat < 0.85)
    throw new Error(
      `sticker background isn't flat (${Math.round(flat * 100)}% of the border matches)`,
    );

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
    const next = [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      y > 0 ? i - W : -1,
      y < H - 1 ? i + W : -1,
    ];
    for (const n of next) {
      if (n >= 0 && !bg[n] && dist(n) < HARD) {
        bg[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  const bgShare = tail / (W * H);
  if (bgShare < 0.12 || bgShare > 0.95)
    throw new Error(
      `sticker cutout looks wrong (${Math.round(bgShare * 100)}% background)`,
    );

  // The model sometimes paints its own white card or white border around the
  // subject (the "white square" stickers). Peel that off too - growing the
  // background through near-white, unsaturated pixels touching it - since we
  // add our own even die-cut border below. A dark outline stops the fill, so
  // white parts inside the drawing survive.
  const whiteish = (i: number) => {
    const [r, g, b] = px(i);
    return (
      Math.min(r, g, b) > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26
    );
  };
  const before = tail;
  const grown = Uint8Array.from(bg);
  const q2 = new Int32Array(W * H);
  let h2 = 0;
  let t2 = 0;
  for (let i = 0; i < W * H; i++) if (grown[i]) q2[t2++] = i;
  while (h2 < t2) {
    const i = q2[h2++];
    const x = i % W;
    const y = (i - x) / W;
    for (const n of [
      x > 0 ? i - 1 : -1,
      x < W - 1 ? i + 1 : -1,
      y > 0 ? i - W : -1,
      y < H - 1 ? i + W : -1,
    ]) {
      if (n >= 0 && !grown[n] && whiteish(n)) {
        grown[n] = 1;
        q2[t2++] = n;
      }
    }
  }
  // Only accept it if it took off a rim, not most of the drawing (e.g. a white subject without an outline).
  const foreground = W * H - before;
  if (t2 - before > 0 && t2 - before < foreground * 0.45) bg.set(grown);

  // Key colour trapped inside the drawing (the hole in a padlock's shackle, between a
  // trophy's handles) never touches the border, so the flood can't reach it. Clear
  // enclosed regions that are almost exactly the key colour and big enough to be a
  // gap - a tight match, so a green leaf or sprout in the drawing is left alone.
  const HOLE = 55;
  const minHole = Math.round(W * H * 0.0015);
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const fleck = new Uint8Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (bg[start] || seen[start] || dist(start) >= HOLE) continue;
    let sp = 0;
    const region: number[] = [];
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      region.push(i);
      const x = i % W;
      const y = (i - x) / W;
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < W - 1 ? i + 1 : -1,
        y > 0 ? i - W : -1,
        y < H - 1 ? i + W : -1,
      ]) {
        if (n >= 0 && !seen[n] && !bg[n] && dist(n) < HOLE) {
          seen[n] = 1;
          stack[sp++] = n;
        }
      }
    }
    if (region.length >= minHole) for (const i of region) bg[i] = 1;
    else for (const i of region) fleck[i] = 1;
  }

  // Smaller enclosed specks of key colour (green showing through a distressed print
  // texture, a seam between two shapes) are too small to be gaps: paint them over
  // from the surrounding drawing instead, along with their anti-aliased halo.
  for (let i = 0; i < W * H; i++) {
    if (!fleck[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const n = ny * W + nx;
        if (
          nx >= 0 &&
          ny >= 0 &&
          nx < W &&
          ny < H &&
          !bg[n] &&
          !fleck[n] &&
          dist(n) < HARD
        )
          fleck[n] = 2;
      }
  }
  for (let pass = 0; pass < 24; pass++) {
    let left = 0;
    const filled: [number, number, number, number][] = [];
    for (let i = 0; i < W * H; i++) {
      if (!fleck[i]) continue;
      const x = i % W;
      const y = (i - x) / W;
      let r = 0,
        g = 0,
        b = 0,
        c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const n = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || fleck[n] || bg[n])
            continue;
          r += data[n * 3];
          g += data[n * 3 + 1];
          b += data[n * 3 + 2];
          c++;
        }
      if (c > 0) filled.push([i, r / c, g / c, b / c]);
      else left++;
    }
    for (const [i, r, g, b] of filled) {
      data[i * 3] = Math.round(r);
      data[i * 3 + 1] = Math.round(g);
      data[i * 3 + 2] = Math.round(b);
      fleck[i] = 0;
    }
    if (left === 0 || filled.length === 0) break;
  }

  // Distance (in px, up to 2) from the background, for the soft rim.
  const nearBg = (i: number) => {
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && bg[ny * W + nx])
          return true;
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
      const t = Math.max(
        0,
        Math.min(1, (dist(i) - HARD * 0.5) / (SOFT - HARD * 0.5)),
      );
      a = Math.round(t * 255);
      // Un-mix the key colour: observed = t*fg + (1-t)*key.
      if (t > 0.02)
        c = c.map((v, k) =>
          Math.max(0, Math.min(255, Math.round((v - (1 - t) * key[k]) / t))),
        );
      // Despill: the key's dominant channel may not exceed the other two on the rim (kills the green hairline).
      const others = [0, 1, 2].filter((k) => k !== dominant).map((k) => c[k]);
      c[dominant] = Math.min(c[dominant], Math.max(...others));
    }
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = a;
  }

  const trimmed = await sharp(out, {
    raw: { width: W, height: H, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
    .png()
    .toBuffer();
  const bordered = await addDieCutBorder(trimmed);
  const png = await sharp(bordered)
    .resize(OUT_MAX, OUT_MAX, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer({ resolveWithObject: true });
  return { png: png.data, width: png.info.width, height: png.info.height };
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * The die-cut edge of a real vinyl sticker: an even white border that follows
 * the silhouette with rounded corners, plus a faint grey hairline on its outer
 * edge so it still reads against a white wall. Built by blurring the alpha
 * channel and thresholding it - a smooth, round "dilation".
 */
async function addDieCutBorder(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const r = Math.max(4, Math.round(Math.max(w, h) * BORDER));
  const pad = r + 4;
  const W = w + pad * 2;
  const H = h + pad * 2;

  const padded = await sharp(png)
    .ensureAlpha()
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();
  const alpha = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = padded[i * 4 + 3];
  // A gaussian of sigma r/2 falls to ~2% of full at distance r: thresholding there grows the shape by ~r.
  // sharp may hand back more than one channel here - read it by its real stride.
  const { data: blurred, info: blurInfo } = await sharp(alpha, {
    raw: { width: W, height: H, channels: 1 },
  })
    .blur(r / 2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = blurInfo.channels;

  const border = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = blurred[i * stride];
    const outer = smoothstep(2, 9, v); // the border's full extent, anti-aliased
    const inner = smoothstep(7, 16, v); // a hair inside it: the white area
    const ring = Math.max(0, outer - inner);
    // White fill, with a soft grey hairline on the very edge.
    const grey = 200;
    const shade =
      Math.round(255 * inner + grey * ring) / Math.max(1e-3, inner + ring);
    border[i * 4] = shade;
    border[i * 4 + 1] = shade;
    border[i * 4 + 2] = Math.min(255, shade + 2);
    border[i * 4 + 3] = Math.round(255 * outer);
  }
  return sharp(border, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: png, left: pad, top: pad }])
    .png()
    .toBuffer();
}
