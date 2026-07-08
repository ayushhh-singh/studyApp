import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A tiny, dependency-free markdown renderer for mentor answers — the only
 * subset the mentor is prompted to emit: '## '/'### ' headings, '**bold**',
 * '- '/'* ' bullets, '1. ' numbered lists, paragraphs, and inline [n] citation
 * markers (rendered as small primary-tinted refs). Devanagari-safe: inherits the
 * body's tall line-height. This is NOT a general HTML renderer — no raw HTML is
 * ever interpreted, so model output can't inject markup.
 */

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold**, *italic*, and [n] citation markers (bold first).
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|\[\d+\])/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^\*[^*\n]+\*$/.test(part)) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (/^\[\d+\]$/.test(part)) {
      return (
        <sup
          key={key}
          className="mx-0.5 rounded bg-primary/10 px-1 text-[0.65em] font-semibold text-primary"
        >
          {part.slice(1, -1)}
        </sup>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Headings
    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        level === 2 ? (
          <h3 key={key++} className="mt-3 text-[0.95rem] font-semibold first:mt-0">
            {renderInline(heading[2], `h${key}`)}
          </h3>
        ) : (
          <h4 key={key++} className="mt-2 text-sm font-semibold first:mt-0">
            {renderInline(heading[2], `h${key}`)}
          </h4>
        ),
      );
      i += 1;
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
        <ul key={key++} className="my-1 list-disc space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ul${key}-${j}`)}</li>
          ))}
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
        <ol key={key++} className="my-1 list-decimal space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ol${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-special lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,3}\s|[-*]\s|\d+\.\s)/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-1 first:mt-0">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className={cn("text-sm leading-relaxed", className)}>{blocks}</div>;
}
