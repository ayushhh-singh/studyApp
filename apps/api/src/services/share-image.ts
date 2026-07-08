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
import type { Locale, MasteryLevel, MasteryMap, WeeklyDigest } from "@prayasup/shared";

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

// ---------------------------------------------------------------------------
// Conquest Map share card — the depth-1 territories as a treemap, coloured by
// mastery. Same weak->strong palette as the web map (concrete hexes since satori
// can't resolve CSS vars). Dark card so it pops when shared.
// ---------------------------------------------------------------------------

const MASTERY_STYLE: Record<MasteryLevel, { fill: string; solid: string }> = {
  unseen: { fill: "rgba(148,163,184,0.16)", solid: "#94A3B8" },
  bronze: { fill: "rgba(244,63,94,0.28)", solid: "#FB7185" },
  silver: { fill: "rgba(245,158,11,0.28)", solid: "#FBBF24" },
  gold: { fill: "rgba(16,185,129,0.28)", solid: "#34D399" },
  exam_ready: { fill: "rgba(96,165,250,0.34)", solid: "#60A5FA" },
};

const MAP_COPY = {
  en: { title: "Conquest Map", brand: "PrayasUP · UPPSC prep", ready: "exam-ready" },
  hi: { title: "कॉन्क्वेस्ट मानचित्र", brand: "PrayasUP · यूपीपीएससी तैयारी", ready: "परीक्षा-तैयार" },
} as const;

interface SquareItem {
  value: number;
  node: MasteryMap["nodes"][number];
}
interface SquareRect {
  item: SquareItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compact squarified treemap in pixel space (mirrors apps/web/src/lib/treemap.ts). */
function squarify(items: SquareItem[], boxW: number, boxH: number): SquareRect[] {
  const out: SquareRect[] = [];
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return out;
  const scale = (boxW * boxH) / total;
  const scaled = positive.map((item) => ({ item, area: item.value * scale }));
  let rect = { x: 0, y: 0, w: boxW, h: boxH };
  let row: { item: SquareItem; area: number }[] = [];
  const worst = (cand: { area: number }[], side: number) => {
    const s = cand.reduce((a, r) => a + r.area, 0);
    if (s <= 0) return Infinity;
    const max = Math.max(...cand.map((r) => r.area));
    const min = Math.min(...cand.map((r) => r.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const flush = () => {
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    if (rowArea <= 0) return;
    if (rect.w >= rect.h) {
      const colW = rowArea / rect.h;
      let oy = rect.y;
      for (const r of row) {
        const h = r.area / colW;
        out.push({ item: r.item, x: rect.x, y: oy, w: colW, h });
        oy += h;
      }
      rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
    } else {
      const rowH = rowArea / rect.w;
      let ox = rect.x;
      for (const r of row) {
        const w = r.area / rowH;
        out.push({ item: r.item, x: ox, y: rect.y, w, h: rowH });
        ox += w;
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }
    row = [];
  };
  for (const sc of scaled) {
    const side = Math.min(rect.w, rect.h);
    const cand = [...row, sc];
    if (row.length === 0 || worst(cand, side) <= worst(row, side)) row = cand;
    else {
      flush();
      row = [sc];
    }
  }
  flush();
  return out;
}

function tileElement(r: SquareRect, locale: Locale): El {
  const s = MASTERY_STYLE[r.item.node.mastery_level];
  const roomy = r.h > 70 && r.w > 120;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      position: "absolute",
      left: `${r.x + 4}px`,
      top: `${r.y + 4}px`,
      width: `${Math.max(0, r.w - 8)}px`,
      height: `${Math.max(0, r.h - 8)}px`,
      padding: "12px",
      borderRadius: "10px",
      backgroundColor: s.fill,
      border: r.item.node.is_priority ? `2px solid ${MASTERY_STYLE.silver.solid}` : "2px solid transparent",
      overflow: "hidden",
    },
    [
      el(
        "div",
        { display: "flex", fontSize: "22px", fontWeight: 700, color: "#F5F6FA", lineHeight: 1.15, overflow: "hidden" },
        r.item.node.title_i18n[locale],
      ),
      roomy
        ? el("div", { display: "flex", alignItems: "center", gap: "8px" }, [
            el("div", { display: "flex", width: "12px", height: "12px", borderRadius: "6px", backgroundColor: s.solid }, ""),
            el("div", { display: "flex", fontSize: "17px", color: s.solid }, `${r.item.node.weight_pct}%`),
          ])
        : el("div", { display: "flex" }, ""),
    ],
  );
}

function masteryMapElement(map: MasteryMap, locale: Locale): El {
  const c = MAP_COPY[locale];
  const root = map.nodes.find((n) => n.depth === 0);
  const paperTitle = root ? root.title_i18n[locale] : "";
  const sections = map.nodes.filter((n) => n.depth === 1 && n.pyq_count > 0).map((node) => ({ value: node.pyq_count, node }));
  const boxW = 1056;
  const boxH = 400;
  const rects = squarify(sections, boxW, boxH);
  const readyCount = map.nodes.filter((n) => n.depth === 1 && n.mastery_level === "exam_ready").length;

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "1200px",
      height: "630px",
      padding: "48px",
      backgroundColor: "#12141C",
      fontFamily: FONT_STACK,
      gap: "20px",
    },
    [
      el("div", { display: "flex", flexDirection: "column", gap: "4px" }, [
        el("div", { display: "flex", fontSize: "34px", fontWeight: 700, color: "#F5F6FA" }, `${c.title} · ${paperTitle}`),
        el("div", { display: "flex", fontSize: "22px", color: "#8B90A0" }, `${readyCount} ${c.ready}`),
      ]),
      el("div", { display: "flex", position: "relative", width: `${boxW}px`, height: `${boxH}px` }, rects.map((r) => tileElement(r, locale))),
      el("div", { display: "flex", fontSize: "22px", fontWeight: 700, color: "#2B4EE0" }, c.brand),
    ],
  );
}

export async function renderMasteryMapPng(map: MasteryMap, locale: Locale): Promise<Buffer> {
  const svg = await satori(masteryMapElement(map, locale) as never, { width: 1200, height: 630, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
