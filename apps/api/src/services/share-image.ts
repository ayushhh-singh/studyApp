/**
 * Server-rendered weekly-digest share image (also the OG-card generator later).
 * satori (JSX-free element tree) -> SVG -> PNG via @resvg/resvg-js. Loads Inter
 * (latin) + Noto Sans Devanagari (Hindi) so both locales render — same font
 * pipeline as the web app, per CLAUDE.md's "Hindi is first-class" rule.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Locale, WeeklyDigest } from "@prayasup/shared";

const require = createRequire(import.meta.url);
const font = (spec: string) => readFileSync(require.resolve(spec));

type LoadedFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

// Loaded lazily on first render and cached — NOT at module init. A missing/renamed
// font file then surfaces as a 500 on this one endpoint (caught by asyncHandler)
// rather than crashing the whole API at boot when routes/engagement.ts is imported.
let fontsCache: LoadedFont[] | null = null;
function loadFonts(): LoadedFont[] {
  if (fontsCache) return fontsCache;
  fontsCache = [
    { name: "Inter", data: font("@fontsource/inter/files/inter-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Inter", data: font("@fontsource/inter/files/inter-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: "Noto Sans Devanagari", data: font("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Noto Sans Devanagari", data: font("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff"), weight: 700, style: "normal" },
  ];
  return fontsCache;
}

const FONT_STACK = 'Inter, "Noto Sans Devanagari"';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = { type: string; props: Record<string, any> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function el(type: string, style: Record<string, any>, children?: (El | string)[] | string): El {
  return { type, props: { style, children } };
}

const COPY = {
  en: { title: "This week on PrayasUP", questions: "Questions", accuracy: "Accuracy", answers: "Answers", streak: "Day streak", brand: "PrayasUP · UPPSC prep" },
  hi: { title: "इस सप्ताह PrayasUP पर", questions: "प्रश्न", accuracy: "सटीकता", answers: "उत्तर", streak: "दिन स्ट्रीक", brand: "PrayasUP · यूपीपीएससी तैयारी" },
} as const;

function stat(value: string, label: string, color: string): El {
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: "6px", flex: 1 },
    [
      el("div", { display: "flex", fontSize: "84px", fontWeight: 700, color }, value),
      el("div", { display: "flex", fontSize: "30px", color: "#B8BCC8" }, label),
    ],
  );
}

function digestElement(d: WeeklyDigest, locale: Locale): El {
  const c = COPY[locale];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "1200px",
      height: "630px",
      padding: "72px",
      backgroundColor: "#12141C",
      fontFamily: FONT_STACK,
      justifyContent: "space-between",
    },
    [
      el("div", { display: "flex", flexDirection: "column", gap: "10px" }, [
        el("div", { display: "flex", fontSize: "34px", fontWeight: 700, color: "#F5F6FA" }, c.title),
        el("div", { display: "flex", fontSize: "26px", color: "#8B90A0" }, `${d.week_start} - ${d.week_end}`),
      ]),
      el("div", { display: "flex", flexDirection: "row", gap: "40px" }, [
        stat(String(d.questions_attempted), c.questions, "#2B4EE0"),
        stat(d.accuracy_pct !== null ? `${Math.round(d.accuracy_pct)}%` : "—", c.accuracy, "#1E9E6C"),
        stat(String(d.answers_evaluated), c.answers, "#F2A93B"),
        stat(String(d.streak_count), c.streak, "#E5484D"),
      ]),
      el("div", { display: "flex", fontSize: "26px", fontWeight: 700, color: "#2B4EE0" }, c.brand),
    ],
  );
}

export async function renderWeeklyDigestPng(digest: WeeklyDigest, locale: Locale): Promise<Buffer> {
  const svg = await satori(digestElement(digest, locale) as never, { width: 1200, height: 630, fonts: loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  return png;
}
