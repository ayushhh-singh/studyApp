import { Link } from "react-router";
import { BookOpen, FileText, Newspaper, HelpCircle } from "lucide-react";
import type { MentorCitation } from "@prayasup/shared";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof BookOpen> = {
  syllabus: BookOpen,
  note: FileText,
  question: HelpCircle,
  current_affairs: Newspaper,
};

/**
 * A numbered citation chip mapping an inline [n] ref to its source. Links to the
 * cited node / note / PYQ / CA item when a deep link exists; otherwise a static
 * pill (still shows what grounded the answer).
 */
export function CitationChip({ citation }: { citation: MentorCitation }) {
  const locale = useLocale();
  const Icon = ICONS[citation.source_type] ?? BookOpen;
  const title = citation.title_i18n[locale] || citation.title_i18n.en || citation.title_i18n.hi;

  const base =
    "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground";

  const inner = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6rem] font-bold text-primary">
        {citation.ref}
      </span>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{title}</span>
    </>
  );

  if (citation.link) {
    return (
      <Link
        to={`/${locale}${citation.link}`}
        className={cn(base, "transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {inner}
      </Link>
    );
  }
  return <span className={base}>{inner}</span>;
}
