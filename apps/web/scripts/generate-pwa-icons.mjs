// One-off generator, not part of the build pipeline — run manually with
// `node scripts/generate-pwa-icons.mjs` whenever public/favicon.svg changes.
// Rasterizes the brand mark onto a solid-color canvas (matching --primary from
// index.css) at every size vite-plugin-pwa's manifest references.
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const mark = readFileSync(path.join(root, "..", "public", "favicon.svg"), "utf8");
const outDir = path.join(root, "..", "public", "pwa");
mkdirSync(outDir, { recursive: true });

const PRIMARY = "#2563EB";

// markScale: how much of the canvas the 48x46 mark occupies. Maskable icons
// need the mark inside Android's ~80%-diameter safe circle, so they get a
// smaller scale + more padding than plain "any" icons.
function canvas(size, { markScale, background }) {
  const w = 48;
  const h = 46;
  const drawSize = size * markScale;
  const scale = drawSize / w;
  const x = (size - w * scale) / 2;
  const y = (size - h * scale) / 2;
  const inner = mark.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${background}"/>
    <g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>
  </svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, markScale: 0.62, background: PRIMARY },
  { file: "icon-512.png", size: 512, markScale: 0.62, background: PRIMARY },
  { file: "icon-maskable-192.png", size: 192, markScale: 0.45, background: PRIMARY },
  { file: "icon-maskable-512.png", size: 512, markScale: 0.45, background: PRIMARY },
  { file: "apple-touch-icon.png", size: 180, markScale: 0.58, background: PRIMARY },
];

for (const t of targets) {
  const svg = canvas(t.size, t);
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, t.file));
  console.log(`wrote pwa/${t.file}`);
}
