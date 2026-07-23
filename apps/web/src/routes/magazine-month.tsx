import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useNavigate, useLocation } from "react-router";
import { ArrowLeft, BookOpenCheck, Languages, ListChecks, Newspaper } from "lucide-react";
import { useMagazineMonths } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";
import { switchLocale } from "@/lib/locale";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { EmptyState } from "@/components/ui-x/empty-state";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";

/**
 * The month landing page — a clean index (TOC) between the month picker and
 * the two print-styled editions, replacing the old single combined document.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { month = "" } = useParams<{ month: string }>();
  const { data: months, isLoading, isError, refetch } = useMagazineMonths();
  const editionsRef = useRef<HTMLDivElement>(null);

  const summary = months?.find((m) => m.month === month) ?? null;

  function toggleLang() {
    navigate(switchLocale(location.pathname, location.search, locale === "hi" ? "en" : "hi", location.hash), {
      replace: true,
    });
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          to={`/${locale}/magazine`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("Magazine.back")}
        </Link>
        <button
          type="button"
          onClick={toggleLang}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Languages className="size-4" /> {locale === "hi" ? "EN" : "हिं"}
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => refetch()} />
        ) : !summary ? (
          <EmptyState icon={Newspaper} title={t("Magazine.emptyTitle")} description={t("Magazine.emptyDescription")} />
        ) : (
          <>
            <div className="mb-8 flex flex-col items-center gap-1 border-b-2 border-primary pb-6 text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {t("Magazine.masthead")}
              </span>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                {summary.title_i18n[locale]}
              </h1>
            </div>

            <div ref={editionsRef} className="flex flex-col gap-4">
              <FirstVisitCoachmark
                sectionKey="magazine"
                targetRef={editionsRef}
                message={t("Explore.coachmarkMagazine")}
                dismissLabel={t("Explore.coachmarkGotIt")}
              />
              {summary.prelims_item_count > 0 && (
                <Link
                  to={`/${locale}/magazine/${month}/prelims`}
                  className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <ListChecks className="size-5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-display text-lg font-bold">{t("Magazine.prelimsEditionTitle")}</span>
                    <span className="text-sm text-muted-foreground">{t("Magazine.prelimsEditionDescription")}</span>
                    <span className="mt-1 text-xs font-semibold text-primary">
                      {t("Magazine.itemCount", { count: summary.prelims_item_count })}
                    </span>
                  </span>
                </Link>
              )}

              {(summary.mains_item_count > 0 || summary.deep_dive_count > 0) && (
                <Link
                  to={`/${locale}/magazine/${month}/mains`}
                  className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-marigold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-marigold/15 text-marigold-foreground">
                    <BookOpenCheck className="size-5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-display text-lg font-bold">{t("Magazine.mainsEditionTitle")}</span>
                    <span className="text-sm text-muted-foreground">{t("Magazine.mainsEditionDescription")}</span>
                    <span className="mt-1 text-xs font-semibold text-marigold-foreground">
                      {t("Magazine.itemCount", { count: summary.mains_item_count })}
                      {summary.deep_dive_count > 0 &&
                        ` · ${t("Magazine.deepDiveCount", { count: summary.deep_dive_count })}`}
                    </span>
                  </span>
                </Link>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
