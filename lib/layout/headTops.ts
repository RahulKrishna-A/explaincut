import sharp from "sharp";

const COLS = 96;

/**
 * Top edge of the speaker (px, in frame coordinates) in each mask sample. A row
 * counts once a few of its sampled pixels are "person", so a stray hand or
 * speckle above the head doesn't count. Failed reads become NaN-free: they
 * repeat the previous value.
 */
export async function computeHeadTops(maskPaths: string[], width: number, height: number): Promise<number[]> {
  const rows = Math.max(8, Math.round((COLS * height) / width));
  const out: number[] = [];
  for (const p of maskPaths) {
    try {
      const { data } = await sharp(p).greyscale().resize(COLS, rows, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      let top = -1;
      for (let y = 0; y < rows && top < 0; y++) {
        let n = 0;
        for (let x = 0; x < COLS; x++) if (data[y * COLS + x] > 127) n++;
        if (n >= 4) top = y;
      }
      out.push(top < 0 ? (out[out.length - 1] ?? height * 0.35) : (top / rows) * height);
    } catch {
      out.push(out[out.length - 1] ?? height * 0.35);
    }
  }
  // 3-tap median smooths single-frame segmentation glitches.
  return out.map((_, i) => {
    const w = [out[Math.max(0, i - 1)], out[i], out[Math.min(out.length - 1, i + 1)]].sort((a, b) => a - b);
    return w[1];
  });
}
