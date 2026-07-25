/**
 * Builds the self-contained, print-ready journal document for a data export
 * (F12). Returns one HTML string with fonts inlined (best-effort) so it renders
 * identically offline and the browser shapes Devanagari perfectly — the user
 * opens it and Save-as-PDF. See services/export.ts for why we don't render the
 * PDF server-side.
 *
 * Copy here is intentionally plain and warm — it carries NO clinical vocabulary
 * (SUKOON_CONTEXT banned-word rule; this file is scanned by the clinical-words
 * lint like the rest of server/src/sukoon).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { SukoonJournalEntry } from "@neev/shared";
import { formatDateBilingual } from "../../lib/ist.js";
import { logger } from "../../lib/logger.js";

const require = createRequire(import.meta.url);

/** Inline the two fonts as base64 @font-face src (cached). Degrades to a system
 * stack if a font file can't be read — the doc still renders, just with the
 * device's own fonts (every modern OS ships Devanagari). */
let fontCss: string | null = null;
function loadFontCss(): string {
  if (fontCss != null) return fontCss;
  try {
    const inter = readFileSync(
      require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"),
    ).toString("base64");
    const deva = readFileSync(
      require.resolve("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff"),
    ).toString("base64");
    fontCss = `
      @font-face { font-family: 'ExportSans'; font-style: normal; font-weight: 400;
        src: url(data:font/woff;base64,${inter}) format('woff'); }
      @font-face { font-family: 'ExportSans'; font-style: normal; font-weight: 400;
        src: url(data:font/woff;base64,${deva}) format('woff'); unicode-range: U+0900-097F; }
    `;
  } catch (err) {
    logger.warn({ err }, "sukoon export: font inline failed, using system stack");
    fontCss = "";
  }
  return fontCss;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** User journal text → HTML, newlines preserved as <br>. */
function bodyHtml(body: string): string {
  return esc(body).replace(/\r?\n/g, "<br>");
}

const MOOD_LABEL: Record<number, { hi: string; en: string }> = {
  1: { hi: "बहुत उदास", en: "Very low" },
  2: { hi: "उदास", en: "Low" },
  3: { hi: "ठीक-ठाक", en: "Okay" },
  4: { hi: "अच्छा", en: "Good" },
  5: { hi: "बहुत अच्छा", en: "Great" },
};

export function buildJournalHtml(entries: SukoonJournalEntry[]): string {
  const items = entries
    .map((e) => {
      const date = formatDateBilingual(e.created_at.slice(0, 10));
      const mood = e.mood != null ? MOOD_LABEL[e.mood] : null;
      const tags =
        e.tags.length > 0
          ? `<div class="tags">${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
          : "";
      const moodLine = mood
        ? `<span class="mood">${esc(mood.hi)} · ${esc(mood.en)}</span>`
        : "";
      const body = e.body ? `<div class="body">${bodyHtml(e.body)}</div>` : `<div class="body empty">—</div>`;
      const reflection = e.reflection
        ? `<div class="reflection"><div class="reflection-label">प्रतिबिंब · Reflection</div>${bodyHtml(e.reflection)}</div>`
        : "";
      return `<article class="entry">
        <header class="entry-head">
          <span class="date">${esc(date.hi)} · ${esc(date.en)}</span>
          ${moodLine}
        </header>
        ${tags}
        ${body}
        ${reflection}
      </article>`;
    })
    .join("\n");

  const empty = `<p class="empty-note">कोई डायरी प्रविष्टि नहीं मिली · No journal entries found.</p>`;

  return `<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>मेरी डायरी · My Journal — Sukoon</title>
<style>
  ${loadFontCss()}
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: 'ExportSans', 'Noto Sans Devanagari', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    max-width: 720px; margin: 0 auto; padding: 40px 24px 64px;
    color: #1f2430; background: #fff; line-height: 1.8;
  }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: #6b7280; font-size: 13px; margin: 0 0 28px; }
  .entry { border-top: 1px solid #e5e7eb; padding: 22px 0; page-break-inside: avoid; }
  .entry-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin-bottom: 6px; }
  .date { font-weight: 600; font-size: 15px; }
  .mood { font-size: 12px; color: #4f46e5; background: #eef2ff; padding: 2px 10px; border-radius: 999px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  .tag { font-size: 11px; color: #0f766e; background: #ccfbf1; padding: 2px 8px; border-radius: 999px; }
  .body { white-space: normal; font-size: 15px; }
  .body.empty { color: #9ca3af; }
  .reflection { margin-top: 12px; padding: 12px 14px; background: #f9fafb; border-radius: 10px; font-size: 14px; color: #374151; }
  .reflection-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 4px; }
  .empty-note { color: #6b7280; }
  .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 0; } .entry { padding: 16px 0; } }
</style>
</head>
<body>
  <h1>मेरी डायरी · My Journal</h1>
  <p class="sub">Sukoon (सुकून) — ${esc(String(entries.length))} entries · exported ${esc(new Date().toISOString().slice(0, 10))}</p>
  ${entries.length > 0 ? items : empty}
  <p class="footer">Tip: use your browser's Print → Save as PDF to keep a copy. · अपने ब्राउज़र में Print → Save as PDF चुनें।</p>
</body>
</html>`;
}
