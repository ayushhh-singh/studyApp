import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowRight, BookOpen, FileQuestion, ListChecks, Sparkles } from "lucide-react";
import type { PaperSummary } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";

/**
 * "Already in Neev" — the free material the user already has, which leads the
 * Resources page.
 *
 * WHY THIS IS FIRST, AND WHY IT IS NOT AN AD. A resources page that only points
 * outward trains the user to leave. Both blocks here are genuinely free, and
 * both are things the external links below cannot give them: chapters written
 * against THIS exam's own syllabus tree and linked to the real past-year
 * questions for each topic, and the past papers already parsed question by
 * question so they can be practised and scored rather than just read.
 *
 * Past papers in particular are the honest answer to "where do I download the
 * question papers": we already hold them. UPSC does publish its own PDFs, but
 * the commission for UPPSC keeps no durable public archive — its paper and key
 * pages are live only during the objection window — so an outward link would be
 * dead for half the audience, while the in-app archive works for both.
 *
 * Every number rendered here is REAL: `chapters_published_count` / `pyq_count` /
 * `topics_count` come straight from `GET /syllabus/papers`, which computes them
 * live per request and is already exam-scoped server-side. Nothing here is a
 * written-down marketing figure, so it cannot go stale the way a hardcoded
 * chapter count does — this repo has shipped a stale "284 chapters" claim twice.
 *
 * ONE query backs both blocks, so the second costs no extra request.
 *
 * SIGNED OUT THIS RENDERS NOTHING. /resources is public, and both blocks are
 * about what YOU have — "your exam", your paper coverage, a paper you can
 * attempt and be scored on. None of that means anything to a visitor with no
 * account, and `GET /syllabus/papers` is behind requireAuth so there are no
 * real numbers to show them either. The public page is then purely the free
 * external material, which is what it promises.
 */
export function NeevLibraryCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  // /resources is public, and GET /syllabus/papers is behind requireAuth — so
  // signed-out this query MUST stay disabled (a 401 would render as a load
  // error on a marketing page) and the card shows a signed-out variant instead.
  const { session } = useAuth();
  const { data, isLoading, isError, refetch } = usePaperSummaries({ enabled: !!session });

  // Papers that actually have something to read. A paper with zero published
  // chapters is omitted rather than shown as a 0 row: this block's claim is
  // "here is what we have", and a 0 beside it reads as a broken promise.
  const withChapters = (data ?? [])
    .filter((p) => p.chapters_published_count > 0)
    .sort((a, b) => b.chapters_published_count - a.chapters_published_count);

  const totalChapters = withChapters.reduce((sum, p) => sum + p.chapters_published_count, 0);
  const totalPyqs = (data ?? []).reduce((sum, p) => sum + p.pyq_count, 0);

  if (!session) return null;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-marigold-foreground" aria-hidden />
          {t("Resources.neevTitle")}
        </span>
      }
      description={t("Resources.neevDescription")}
    >
      {isError ? (
        <QueryErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* ── Past papers ───────────────────────────────────────────────── */}
          {totalPyqs > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileQuestion className="size-4 text-primary" aria-hidden />
                {t("Resources.papersTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("Resources.papersBody", { count: totalPyqs })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link to={`/${locale}/pyq-archive`}>{t("Resources.papersBrowse")}</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/${locale}/practice?tab=pyq`}>{t("Resources.papersAttempt")}</Link>
                </Button>
              </div>
            </div>
          )}

          {/* ── Study chapters ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-tulsi-foreground" aria-hidden />
              {t("Resources.chaptersTitle")}
            </h3>
            {withChapters.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={t("Resources.neevEmptyTitle")}
                description={t("Resources.neevEmptyBody")}
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("Resources.chaptersBody", { count: totalChapters })}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {withChapters.map((paper) => (
                    // min-w-0: a grid item's default min-width is `auto`, so its
                    // content sets the track's floor and a long paper title
                    // pushes the whole row past the viewport instead of letting
                    // `truncate` do its job. Confirmed live: 412px rows inside a
                    // 390px viewport, 59px of horizontal page overflow. Same
                    // trap SectionCard documents on its own root.
                    <li key={paper.paper_code} className="min-w-0">
                      <PaperRow paper={paper} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function PaperRow({ paper }: { paper: PaperSummary }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Link
      to={`/${locale}/learn/${paper.paper_code}`}
      className="group flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <ListChecks className="size-4" aria-hidden />
      </span>
      {/* ⚑ NO COVERAGE BAR HERE, DELIBERATELY. `chapters_published_count`
          counts the WHOLE tree while `topics_count` is depth-1 only — CLAUDE.md
          records that as two different metrics by design — so their ratio is
          not a percentage. Measured live it runs 100%-633% and clamps to a full
          bar on every paper, which reads as "complete" for a paper that is 24%
          covered. The chapter count is the honest signal; there is no all-nodes
          denominator on this endpoint to divide by. (/learn's own paper cards
          still compute notes_published_count / topics_count the same way and
          have the same defect — flagged, not fixed here.) */}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{paper.title_i18n[locale]}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("Resources.neevPaperChapters", { count: paper.chapters_published_count })}
          </span>
        </span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
