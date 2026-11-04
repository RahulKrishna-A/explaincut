/** Generates sticker(s) for the given subjects and writes raw + cutout PNGs (calls Muse Image, $0.01 each). */
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../lib/loadEnv";
import { generateImage } from "../lib/meta/image";
import { cutOutSticker } from "../lib/stickers/cutout";
import { stickerPrompt } from "../lib/stickers/prepare";

async function main() {
  loadEnvLocal();
  const [out, ...subjects] = process.argv.slice(2);
  await fs.mkdir(out, { recursive: true });
  await Promise.all(
    subjects.map(async (s, i) => {
      console.time(s);
      const raw = await generateImage(stickerPrompt(s));
      console.timeEnd(s);
      await fs.writeFile(path.join(out, `raw-${i}.png`), raw);
      try {
        const cut = await cutOutSticker(raw);
        await fs.writeFile(path.join(out, `cut-${i}.png`), cut.png);
        console.log(s, "->", cut.width, "x", cut.height, cut.png.length, "bytes");
      } catch (e) {
        console.error(s, "cutout failed:", e);
      }
    })
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
