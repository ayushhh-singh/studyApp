import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, Flame, Layers } from "lucide-react";
import type { Locale, SrsCardSource, SrsCardWeightage } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";

/**
 * The context strip under a revealed card: which topic it belongs to, how heavily
 * that topic is examined, and a way out to the chapter.
 *
 * ⚑ SHOWN ONLY AFTER REVEAL, deliberately. Naming the topic on the FRONT would
 * hand over a large part of the answer — "Indian Polity and Governance" narrows a
 * question enormously — and a flashcard's whole value is the unaided retrieval
 * attempt. So the front stays a clean prompt and every piece of context lands the
 * moment recall has already been tested.
 *
 * Every element is independently optional: a card with no resolvable origin
 * renders nothing at all, a topic that has never been examined shows no
 * frequency, and a topic with no published chapter shows the topic without a
 * link. An absent chip always beats a broken one.
 */
export function CardMeta({
  source,
  weightage,
  displayLocale,
}: {
  source: SrsCardSource | null;
  weightage: SrsCardWeightage | null;
  /** The card's own language toggle, so the topic name matches the text above it. */
  displayLocale: Locale;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!source) return null;

  const title = source.title_i18n[displayLocale] || source.title_i18n.en || source.title_i18n.hi;

  return (
    <div data-slot="card-meta" className="flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span data-chip="topic" className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground/80">
          <Layers className="size-3 shrink-0" aria-hidden />
          <span className="truncate" data-locale={displayLocale}>
            {title}
          </span>
        </span>

        {weightage && (
          // Frequency is the signal a bare flashcard cannot give: it says whether
          // the thing you just failed to recall is a recurring exam topic or a
          // one-off. Marigold + its PAIRED foreground — the raw token as text
          // measures 1.6:1 on a light card (the design system's most-repeated bug).
          <span data-chip="weightage" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-marigold/15 px-2.5 py-1 text-xs font-semibold text-marigold-foreground tabular-nums">
            <Flame className="size-3" aria-hidden />
            {t("Revision.askedTimes", { count: weightage.asked })}
            <span className="font-normal opacity-80">· {t("Revision.lastAsked", { year: weightage.last_year })}</span>
          </span>
        )}
      </div>

      {source.has_chapter && (
        // The escape hatch. Ratings are saved per card as they are given (the
        // offline queue flushes on unmount), so leaving mid-session costs nothing
        // — the cards not yet reviewed simply stay due.
        <Link
          to={`/${locale}/learn/${source.paper_code}/${source.node_id}?tab=notes`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-primary transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen className="size-4" aria-hidden />
          {t("Revision.readChapter")}
        </Link>
      )}
    </div>
  );
}
