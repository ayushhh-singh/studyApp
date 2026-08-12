// One-off generator, not part of the build pipeline — run manually with
// `node scripts/generate-hero-art.mjs` whenever scripts/assets/brand-mark-source.png
// changes. Sibling of generate-pwa-icons.mjs; read that file's header first.
//
// WHY THIS EXISTS. The logo raster is drawn on its own rounded-SQUARE plate
// with a bright rim-light baked in (measured: the plate edge sits 49-84px in
// from each side, the rim highlight peaks at 72-96px and reaches luminance
// 253 along the top). That is correct for an app icon and correct for the
// auth panel, which is deliberately echoing the installed app icon — but in
// the marketing HERO the plate lands inside BrandPanel's own rounded navy
// container, so the page renders two concentric rounded rectangles with a
// bright rim between them. It reads as an icon dropped onto the page rather
// than as hero artwork, which is the opposite of what BrandPanel's docblock
// claimed. Hence a hero-specific asset that bleeds into its container.
//
// WHAT THIS IS NOT. This does not redraw, re-shape or re-mask THE LOGO. Every
// logo slot — /pwa/*, favicon.png, and the nav brand-mark — still comes from
// generate-pwa-icons.mjs and is byte-identical. This writes a separate
// illustration used only in marketing panels. Keep it that way: the standing
// rule ("never redraw it as a vector, never re-shape it", see the design skill
// and the reverted circle-mask in generate-pwa-icons.mjs) is about the mark
// itself, and nothing here changes the mark.
//
// HOW THE FADE IS BUILT. A rounded-rect alpha mask, inset past the rim, blurred
// into a soft ramp, then steepened with a levels curve. The curve is the part
// that matters: a plain blur wide enough to erase the rim also washes out the
// outermost leaves (the tree's own content starts ~110px in, barely past the
// rim), so the gain pushes mid-alphas back to opaque while the outer band still
// reaches a true zero. Measured on the shipped values: alpha 0 at the corner,
// ~15/255 across the rim band, fully opaque from ~200px in — i.e. rim gone,
// leaves untouched.
//
// GOTCHA: keep the mask in RAW single-channel space. Encoding it to PNG and
// re-decoding returns THREE channels, which silently breaks the per-pixel index
// math and yields an untouched image — four different masks produced four
// byte-identical files before this was caught. The length assert below is what
// makes that failure loud instead of invisible.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "assets", "brand-mark-source.png");
const outDir = path.join(root, "..", "public", "brand");
mkdirSync(outDir, { recursive: true });

/** The source's native size — nothing is upscaled before the final resize. */
const BASE = 1254;

/**
 * Rendered at most 26rem (416px CSS) in the hero, so 1024 covers ~2.4x DPR.
 * WebP because the fade is a large smooth gradient: the same image as PNG is
 * 1524KB against 211KB here, and a 256-colour palette (the trick used for the
 * marketing screenshots) bands badly on the navy ramp. The asset it replaces
 * in these panels was a 542KB icon PNG.
 */
const SIZE = 1024;

const INSET = 170; // clears the rim band (ends by 98px) with margin
const RADIUS = 540; // follows the artwork's own rounded-square composition
const SIGMA = 110; // fade width
const GAIN = 2.2; // steepen, so leaves stay opaque
const LIFT = -90;

const svg = `<svg width="${BASE}" height="${BASE}">
  <rect width="${BASE}" height="${BASE}" fill="#000"/>
  <rect x="${INSET}" y="${INSET}" width="${BASE - INSET * 2}" height="${BASE - INSET * 2}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/>
</svg>`;

const mask = await sharp(Buffer.from(svg))
  .blur(SIGMA)
  .greyscale()
  .linear(GAIN, LIFT)
  .raw({ depth: "uchar" })
  .toBuffer();
if (mask.length !== BASE * BASE) {
  throw new Error(`mask must be single-channel raw; got ${mask.length} for ${BASE * BASE} px`);
}

const { data } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const art = Buffer.from(data);
for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
  art[p] = ((art[p] * mask[i] + 127) / 255) | 0;
}

const alphaAt = (x, y) => art[(y * BASE + x) * 4 + 3];
if (alphaAt(4, 4) !== 0) throw new Error("corner must be fully transparent — no plate boundary");
if (alphaAt(627, 627) < 250) throw new Error("centre must stay opaque — the tree is being eaten");

const file = path.join(outDir, "tree-hero.webp");
await sharp(art, { raw: { width: BASE, height: BASE, channels: 4 } })
  .resize(SIZE, SIZE)
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(file);
console.log(`wrote ${path.relative(path.join(root, ".."), file)}`);
