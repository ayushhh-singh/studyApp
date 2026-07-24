// One-off generator, not part of the build pipeline — run manually with
// `node scripts/generate-sukoon-pwa-icons.mjs` whenever public/sukoon-mark.svg
// changes. Mirrors generate-pwa-icons.mjs's approach for the Neev mark:
// rasterizes onto a solid-color canvas at every size the standalone Sukoon
// PWA manifest (vite.config.ts) references. sukoon-mark.svg is an explicit
// placeholder — replace both it and this output before any real deploy.
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const mark = readFileSync(path.join(root, "..", "public", "sukoon-mark.svg"), "utf8");
const outDir = path.join(root, "..", "public", "pwa");
mkdirSync(outDir, { recursive: true });

const SAND = "#F4EDE3";

function canvas(size, { markScale, background }) {
  const w = 40;
  const h = 40;
  const drawSize = size * markScale;
  const scale = drawSize / w;
  const x = (size - w * scale) / 2;
  const y = (size - h * scale) / 2;
  const inner = mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${background}"/>
    <g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>
  </svg>`;
}

const targets = [
  { file: "sukoon-icon-192.png", size: 192, markScale: 0.72, background: SAND },
  { file: "sukoon-icon-512.png", size: 512, markScale: 0.72, background: SAND },
  { file: "sukoon-icon-maskable-192.png", size: 192, markScale: 0.5, background: SAND },
  { file: "sukoon-icon-maskable-512.png", size: 512, markScale: 0.5, background: SAND },
];

for (const t of targets) {
  const svg = canvas(t.size, t);
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, t.file));
  console.log(`wrote pwa/${t.file}`);
}
