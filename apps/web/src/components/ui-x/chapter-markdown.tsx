import { Fragment, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NoteSource } from "@neev/shared";

/**
 * Dependency-free Markdown renderer for study CHAPTER bodies (Session 28). Handles
 * the subset the chapter generator emits: paragraphs, '- '/'* ' bullets, '1.'
 * ordered lists, **bold** / *italic* / `code`, GitHub-style '|' tables, and inline
 * [S2] source citations (resolved against the note's `sources`). No raw HTML is
 * ever interpreted. Tables scroll horizontally so they never overflow at 390px;
 * Devanagari gets the taller line-height the design system mandates.
 */

function renderInline(text: string, keyBase: string, sources?: NoteSource[]): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[S\d+\])/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={key} className="italic">{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    if (/^\[S\d+\]$/.test(part)) {
      const id = part.slice(1, -1);
      const src = sources?.find((s) => s.id === id);
      // Only render a clickable link for a real http(s) URL — a source grounded in
      // our own bank (no external URL) still gets a plain numbered citation.
      if (src?.url && /^https?:\/\//.test(src.url)) {
        return (
          <a key={key} href={src.url} target="_blank" rel="noreferrer" title={src.title}
             className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-[0.65em] font-semibold text-primary align-super">
            {id}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        );
      }
      return <sup key={key} className="mx-0.5 rounded bg-primary/10 px-1 text-[0.65em] font-semibold text-primary">{id}</sup>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.includes("|");
}
function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}
function splitCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/**
 * How this markdown's `##`/`###`/`####` map onto real heading elements.
 *
 * ⚑ `"sub"` IS THE DEFAULT AND MUST STAY THE DEFAULT. A study chapter's body is
 * rendered INSIDE a section that already owns the page's h2/h3, so every heading
 * inside that body is a sub-heading and flattening them all to a small `h4` is
 * correct there — 362 published chapters render this way.
 *
 * `"document"` is for the case where this markdown IS the document: a content-hub
 * article, whose `bodyMd` carries the page's actual section structure beneath a
 * single `h1`. Under `"sub"` such a page renders with ZERO `h2` elements — it
 * throws away the heading outline a crawler reads, and visually gives a
 * 7,000-character article no section hierarchy at all. Found by the browser pass
 * on the first published article, not by review.
 */
export type MarkdownHeadingScale = "sub" | "document";

const DOCUMENT_HEADINGS: Record<number, { Tag: "h2" | "h3" | "h4"; className: string }> = {
  2: { Tag: "h2", className: "mt-10 scroll-mt-24 text-2xl font-bold tracking-tight first:mt-0" },
  3: { Tag: "h3", className: "mt-8 text-lg font-bold tracking-tight first:mt-0" },
  4: { Tag: "h4", className: "mt-6 text-base font-semibold first:mt-0" },
};

export function ChapterMarkdown({
  content,
  locale,
  sources,
  className,
  headingScale = "sub",
}: {
  content: string;
  locale: "hi" | "en";
  sources?: NoteSource[];
  className?: string;
  headingScale?: MarkdownHeadingScale;
}) {
  const lines = (content ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const lead = locale === "hi" ? "leading-[1.95]" : "leading-[1.75]";
  const listLead = locale === "hi" ? "leading-[1.9]" : "leading-relaxed";
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i += 1; continue; }

    // Heading. Under "sub" every level flattens to a small h4 (the section
    // around this body already owns h2/h3); under "document" the levels are
    // real, because this markdown IS the document. See MarkdownHeadingScale.
    const heading = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      if (headingScale === "document") {
        const { Tag, className: headingClass } = DOCUMENT_HEADINGS[heading[1].length] ?? DOCUMENT_HEADINGS[4];
        blocks.push(
          <Tag key={key++} className={`${headingClass} text-foreground`}>
            {renderInline(heading[2], `h${key}`, sources)}
          </Tag>,
        );
      } else {
        blocks.push(
          <h4 key={key++} className="mt-4 text-[0.95rem] font-semibold text-foreground first:mt-0">
            {renderInline(heading[2], `h${key}`, sources)}
          </h4>,
        );
      }
      i += 1;
      continue;
    }

    // GFM table: a row line immediately followed by a separator line.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitCells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60">
                {header.map((h, j) => (
                  <th key={j} className="border-b border-border px-3 py-2 text-start font-semibold text-foreground" lang={locale}>
                    {renderInline(h, `th${key}-${j}`, sources)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-muted/20">
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-border/60 px-3 py-2 align-top text-foreground/90" lang={locale}>
                      {renderInline(c, `td${key}-${ri}-${ci}`, sources)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className={cn("my-2 list-disc space-y-1.5 ps-5", listLead)}>
          {items.map((it, j) => (<li key={j} lang={locale}>{renderInline(it, `ul${key}-${j}`, sources)}</li>))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className={cn("my-2 list-decimal space-y-1.5 ps-5", listLead)}>
          {items.map((it, j) => (<li key={j} lang={locale}>{renderInline(it, `ol${key}-${j}`, sources)}</li>))}
        </ol>,
      );
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,4}\s|[-*]\s|\d+\.\s)/.test(lines[i].trim()) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) {
      blocks.push(
        <p key={key++} className={cn("my-2 first:mt-0", lead)} lang={locale}>
          {renderInline(para.join(" "), `p${key}`, sources)}
        </p>,
      );
    }
  }

  return <div className={cn("text-[15px] text-foreground/90", className)}>{blocks}</div>;
}
