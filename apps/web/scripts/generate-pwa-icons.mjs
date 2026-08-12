// One-off generator, not part of the build pipeline — run manually with
// `node scripts/generate-pwa-icons.mjs` whenever scripts/assets/brand-mark-source.png
// changes.
//
// The source is the real Neev logo: a flat, pre-composed raster illustration
// (glowing tree of knowledge, roots below, branches above, a child reading at
// the trunk) at 1254x1254, drawn on its own rounded-square plate with real
// alpha around it. It is NOT a vector we control and is deliberately NOT
// redrawn or re-shaped — the icons must be the actual logo.
//
// DO NOT circle-mask this source. It was tried during the 2026-08 brand
// refresh, to match the circular badge in docs/design/reference-3's NAVIGATION
// panels: because the artwork is a rounded SQUARE, a circle clips its corners
// and the added rim lands on top of the plate edge. The reference's badge is
// drawn as a circle from scratch; ours is drawn as a rounded square, and one
// cannot be converted into the other by masking. The logo keeps its own shape.
//
// Two treatments, because the icon slots are masked differently:
//   any / favicon — the source as-is, alpha preserved, just resized.
//   maskable      — full-bleed navy square with the source inset to ~72%. A
//                   maskable icon may be cropped to a circle OR a squircle by
//                   the launcher and only the inner 80% is guaranteed safe, so
//                   a full-bleed plate would get its corners shaved off.
//   apple         — same inset idea but flattened, slightly larger: Apple
//                   explicitly recommends no alpha (a transparent touch icon
//                   can render black in some contexts) and iOS's own squircle
//                   crops far less than the maskable safe zone.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "assets", "brand-mark-source.png");
const publicDir = path.join(root, "..", "public");
const outDir = path.join(publicDir, "pwa");
mkdirSync(outDir, { recursive: true });

/** Brand navy — docs/design/reference-2 COLOR PALETTE. Matches --brand-navy. */
const NAVY = "#0B1D3B";

/** Work at the source's native size so nothing is upscaled before the final resize. */
const BASE = 1254;

/** Full-bleed navy square with the logo inset, for mask-cropped slots. */
async function insetOnNavy(inset) {
  const artSize = Math.round(BASE * inset);
  const art = await sharp(source).resize(artSize, artSize).png().toBuffer();
  const offset = Math.round((BASE - artSize) / 2);
  return sharp({ create: { width: BASE, height: BASE, channels: 4, background: NAVY } })
    .composite([{ input: art, left: offset, top: offset }])
    .png()
    .toBuffer();
}

const maskable = await insetOnNavy(0.76);
const apple = await insetOnNavy(0.86);

// .png() output is lossless by construction (compressionLevel only trades file
// size for CPU, never quality) and sharp's default downscale kernel is already
// lanczos3 — so every generated size preserves as much of the source's detail
// as its own pixel count allows. The only place detail is unavoidably lost is a
// real 16-32px browser tab, which no resize technique changes: that's a
// physical pixel-count limit, not a quality setting here.
const targets = [
  { file: path.join(outDir, "icon-192.png"), size: 192, from: source },
  { file: path.join(outDir, "icon-512.png"), size: 512, from: source },
  { file: path.join(outDir, "icon-maskable-192.png"), size: 192, from: maskable },
  { file: path.join(outDir, "icon-maskable-512.png"), size: 512, from: maskable },
  { file: path.join(outDir, "apple-touch-icon.png"), size: 180, from: apple, flatten: NAVY },
  { file: path.join(publicDir, "favicon.png"), size: 96, from: source },
];

for (const t of targets) {
  let img = sharp(t.from).resize(t.size, t.size);
  if (t.flatten) img = img.flatten({ background: t.flatten });
  await img.png().toFile(t.file);
  console.log(`wrote ${path.relative(publicDir, t.file)}`);
}
