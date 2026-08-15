import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, CalendarCheck, Layers, RotateCcw } from "lucide-react";
import type { Locale, SrsCardProvenance, SrsCardSource, SrsCardWeightage } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";

/**
 * The context strip under a revealed card: what this question actually IS, how
 * often its topic is examined, whether you keep forgetting it, and a way out to
 * the chapter.
 *
 * ⚑ SHOWN ONLY AFTER REVEAL, deliberately. Naming the topic on the FRONT would
 * hand over a large part of the answer — "Indian Polity and Governance" narrows a
 * question enormously — and a flashcard's whole value is the unaided retrieval
 * attempt. So the front stays a clean prompt and every piece of context lands the
 * moment recall has already been tested.
 *
 * ⚑ WHY THIS IS NOT "asked 53x" ANY MORE. That chip sat beside a specific
 * question while describing its TOPIC, so it read as a claim about the question
 * ("this was asked 53 times" — false), and a bare 53 has no reference frame: out
 * of what, over how many years? It also could not be acted on mid-review. What
 * replaced it is a fact about the question itself (it is a real past-year
 * question, from this year) plus a topic rate whose denominator — one exam a
 * year — is the unit every aspirant already thinks in, rendered ATTACHED to the
 * topic name so the referent cannot be misread.
 *
 * Every element is independently optional. A generated question has no year; a
 * never-examined topic has no rate; a card you have never failed has no lapse
 * chip; a topic with no published chapter shows no link. An absent chip always
 * beats a wrong one.
 */
export function CardMeta({
  source,
  weightage,
  provenance,
  lapses,
  displayLocale,
}: {
  source: SrsCardSource | null;
  weightage: SrsCardWeightage | null;
  provenance: SrsCardProvenance | null;
  /** FSRS lapse count — how many times this card has been rated "Again" after being learned. */
  lapses: number;
  /** The card's own language toggle, so the topic name matches the text above it. */
  displayLocale: Locale;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!source) return null;

  const title = source.title_i18n[displayLocale] || source.title_i18n.en || source.title_i18n.hi;
  // Below one a year, "~0 a year" would read as "never asked", which is both
  // wrong and discouraging — say it plainly instead.
  const rate =
    weightage === null
      ? null
      : weightage.per_year >= 1
        ? t("Revision.perYear", { count: Math.round(weightage.per_year) })
        : t("Revision.rarelyAsked");

  return (
    <div data-slot="card-meta" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {provenance && (
          // The headline, and the only chip that is a fact about THIS question:
          // it really was on that paper, that year.
          <span
            data-chip="provenance"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums"
          >
            <CalendarCheck className="size-3" aria-hidden />
            {t(`Revision.askedIn_${provenance.exam_stage === "mains" ? "mains" : "prelims"}`, {
              year: provenance.year,
            })}
          </span>
        )}

        {lapses > 0 && (
          // The most actionable per-CARD signal there is: you have already
          // learned this and lost it. Coral + its PAIRED foreground, never the
          // raw token as text.
          <span
            data-chip="lapses"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-coral/15 px-2.5 py-1 text-xs font-semibold text-coral-foreground tabular-nums"
          >
            <RotateCcw className="size-3" aria-hidden />
            {t("Revision.forgottenTimes", { count: lapses })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Layers className="size-3 shrink-0" aria-hidden />
          {/* The rate lives on the same line as the topic name, immediately after
              it, so it can only be read as a property OF the topic. */}
          <span className="min-w-0 truncate" data-locale={displayLocale}>
            {title}
          </span>
        </span>
        {rate && (
          <span data-chip="rate" className="shrink-0 tabular-nums">
            · {rate}
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
