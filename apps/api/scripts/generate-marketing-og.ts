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

const COPY = {
  en: {
    title: "AI Answer Evaluation for UPPSC",
    subtitle: "PYQ practice, syllabus-mapped notes, and spaced revision — bilingual, exam-focused.",
    brand: "PrayasUP",
  },
  hi: {
    title: "UPPSC के लिए AI उत्तर मूल्यांकन",
    subtitle: "PYQ अभ्यास, पाठ्यक्रम-आधारित नोट्स, और स्पेस्ड रिवीजन — द्विभाषी, परीक्षा-केंद्रित।",
    brand: "PrayasUP",
  },
} as const;

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
      backgroundColor: "#0D1526",
      backgroundImage: "linear-gradient(135deg, #0D1526 0%, #131B33 60%, #1B1440 100%)",
      fontFamily: FONT_STACK,
    },
    [
      el(
        "div",
        { display: "flex", alignItems: "center", gap: "16px", marginBottom: "48px" },
        [
          el("div", {
            display: "flex",
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            backgroundColor: "#2563EB",
          }, ""),
          el("div", { display: "flex", fontSize: "36px", fontWeight: 700, color: "#F7F9FC" }, c.brand),
        ],
      ),
      el("div", { display: "flex", fontSize: "58px", fontWeight: 700, color: "#F7F9FC", lineHeight: 1.2, maxWidth: "980px" }, c.title),
      el("div", { display: "flex", fontSize: "30px", color: "#9AA5B8", marginTop: "24px", maxWidth: "900px", lineHeight: 1.5 }, c.subtitle),
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
