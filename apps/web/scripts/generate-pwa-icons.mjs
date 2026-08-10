// One-off generator, not part of the build pipeline — run manually with
// `node scripts/generate-pwa-icons.mjs` whenever scripts/assets/brand-mark-source.png
// changes. The source is a flat, pre-composed raster (not a vector we control),
// so this just resizes it into every size the favicon/PWA manifest reference —
// no background/scale logic needed, the source already has its own padding
// and (where present) background baked in.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "assets", "brand-mark-source.png");
const publicDir = path.join(root, "..", "public");
const outDir = path.join(publicDir, "pwa");
mkdirSync(outDir, { recursive: true });

// Apple explicitly recommends apple-touch-icon have NO alpha transparency —
// iOS's handling of a transparent touch icon is inconsistent (can render as
// black in some contexts). Flattened onto near-black here so it blends with
// the current source's own dark vignette; harmless no-op if a future source
// has no alpha (flatten only affects images that actually have transparency).
const targets = [
  { file: path.join(outDir, "icon-192.png"), size: 192 },
  { file: path.join(outDir, "icon-512.png"), size: 512 },
  { file: path.join(outDir, "icon-maskable-192.png"), size: 192 },
  { file: path.join(outDir, "icon-maskable-512.png"), size: 512 },
  { file: path.join(outDir, "apple-touch-icon.png"), size: 180, flattenBg: "#050a1f" },
  { file: path.join(publicDir, "favicon.png"), size: 96 },
];

// .png() output is lossless by construction (compressionLevel only trades
// file size for CPU, never quality) and sharp's default downscale kernel is
// already lanczos3 — so every generated size preserves as much of the
// source's detail as its own pixel count allows. The only place detail is
// unavoidably lost is a real 16-32px browser tab, which no resize technique
// changes: that's a physical pixel-count limit, not a quality setting here.
for (const t of targets) {
  let img = sharp(source).resize(t.size, t.size);
  if (t.flattenBg) img = img.flatten({ background: t.flattenBg });
  await img.png().toFile(t.file);
  console.log(`wrote ${path.relative(publicDir, t.file)}`);
}
