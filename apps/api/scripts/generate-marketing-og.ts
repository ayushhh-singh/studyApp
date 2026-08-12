/**
 * One-off generator (not part of the request-serving app) for the static
 * og:image cards on the public marketing pages (landing, pricing). Re-run
 * manually with `pnpm --filter api og:generate` whenever the brand copy
 * changes. Reuses the same satori -> resvg font pipeline as
 * services/share-image.ts so Devanagari renders correctly, rather than
 * relying on whatever fonts happen to be installed on the machine running
 * the script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const font = (spec: string) => readFileSync(require.resolve(spec));

const fonts = [
  { name: "Inter", data: font("@fontsource/inter/files/inter-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Inter", data: font("@fontsource/inter/files/inter-latin-700-normal.woff"), weight: 700 as const, style: "normal" as const },
  { name: "Noto Sans Devanagari", data: font("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Noto Sans Devanagari", data: font("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff"), weight: 700 as const, style: "normal" as const },
];
const FONT_STACK = 'Inter, "Noto Sans Devanagari"';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = { type: string; props: Record<string, any> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function el(type: string, style: Record<string, any>, children?: (El | string)[] | string): El {
  return { type, props: { style, children } };
}

/**
 * ⚑ This card is the FIRST thing anyone sees when a Neev link is pasted into
 * WhatsApp, X or LinkedIn, which makes it the highest-leverage stale asset in
 * the repo. It previously said "AI Answer Evaluation for UPPSC" — false since
 * upsc went live on 2026-08-11 — over a plain blue rounded SQUARE standing in
 * for the logo, on the pre-refresh palette. Keep this in step with the
 * landing page's own headline.
 */
const COPY = {
  en: {
    title: "Strong roots. Bright future.",
    subtitle: "AI-evaluated Mains answers, 7,400+ past-year questions and fact-checked study chapters — bilingual, built for civil-services aspirants.",
    brand: "Neev",
  },
  hi: {
    title: "मज़बूत नींव। उज्ज्वल भविष्य।",
    subtitle: "AI-जाँचित मुख्य परीक्षा उत्तर, 7,400+ पिछले वर्षों के प्रश्न और तथ्य-जाँचे अध्ययन अध्याय — द्विभाषी, सिविल सेवा अभ्यर्थियों के लिए।",
    brand: "नींव",
  },
} as const;

/**
 * The real brand mark, inlined as a data URI. satori cannot fetch a URL and
 * cannot read CSS variables, so both the artwork and every colour here are
 * literals that must be kept in step with `apps/web/src/index.css` by hand —
 * which is exactly how the old card drifted a whole rebrand behind.
 */
const BRAND_MARK_DATA_URI = (() => {
  const p = path.resolve(import.meta.dirname, "../../web/public/pwa/icon-512.png");
  return `data:image/png;base64,${readFileSync(p).toString("base64")}`;
})();

/** Literal copies of the current brand tokens (see index.css). */
const BRAND = { navy: "#0B1D3B", deep: "#061225", gold: "#F7C873", ink: "#F7F9FC", muted: "#AEBBD0" } as const;

function cardElement(locale: "en" | "hi"): El {
  const c = COPY[locale];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      width: "1200px",
      height: "630px",
      padding: "80px",
      backgroundColor: BRAND.deep,
      backgroundImage: `linear-gradient(135deg, ${BRAND.deep} 0%, ${BRAND.navy} 55%, #12305C 100%)`,
      fontFamily: FONT_STACK,
    },
    [
      el(
        "div",
        { display: "flex", alignItems: "center", gap: "16px", marginBottom: "48px" },
        [
          { type: "img", props: { src: BRAND_MARK_DATA_URI, width: 72, height: 72, style: { borderRadius: "18px" } } },
          el("div", { display: "flex", fontSize: "38px", fontWeight: 700, color: BRAND.ink }, c.brand),
        ],
      ),
      el("div", { display: "flex", fontSize: "62px", fontWeight: 700, color: BRAND.ink, lineHeight: 1.25, maxWidth: "980px" }, c.title),
      el("div", { display: "flex", fontSize: "28px", color: BRAND.muted, marginTop: "24px", maxWidth: "940px", lineHeight: 1.5 }, c.subtitle),
      // A gold rule ties the card to the brand's one constant accent.
      el("div", { display: "flex", width: "120px", height: "6px", borderRadius: "3px", backgroundColor: BRAND.gold, marginTop: "40px" }, ""),
    ],
  );
}

async function generate(locale: "en" | "hi"): Promise<void> {
  const svg = await satori(cardElement(locale) as never, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  const outPath = path.resolve(import.meta.dirname, "../../web/public", `og-default-${locale}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath}`);
}

await generate("en");
await generate("hi");
