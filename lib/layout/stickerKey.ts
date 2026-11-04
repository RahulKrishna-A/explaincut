/** How a sticker op's subject text maps to its generated asset (shared by Node and the Remotion bundle). */
export function stickerKey(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
