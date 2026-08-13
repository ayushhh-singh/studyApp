import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, FileQuestion, Printer } from "lucide-react";
import { questionsResponseSchema, type Question } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { useLocale } from "@/hooks/use-locale";
import { api } from "@/lib/api";
import { formatQuestionStem } from "@/lib/format-question-stem";

export const handle = { titleKey: "PyqArchive.printTitle" };

/**
 * A whole past-year paper, laid out for print-to-PDF.
 *
 * WHY THIS ROUTE EXISTS. "Download the question paper" has no outward answer
 * that works for both exams: UPSC publishes its own paper PDFs, but UPPSC's
 * paper and answer-key handlers are session-gated and cold-bounce to the
 * homepage, so a link would be dead for most of this audience. This renders the
 * paper from OUR OWN parsed bank instead, which works identically for every
 * exam, comes out bilingual, and carries the answer key we verified.
 *
 * Print-to-PDF rather than a server-generated file, matching the magazine
 * editions' established pattern: it reuses the app's own typography (including
 * Devanagari, which a hand-rolled PDF would need fonts embedded for) and adds
 * no dependency or server CPU.
 *
 * Outside app-shell on purpose — the same reason the magazine editions are:
 * printing must not carry sidebar/tab-bar chrome.
 */

/** Fetch EVERY page of a paper+year, not just the first 20. */
function useWholePaper(paper: string, year: number | null) {
  return useQuery({
    queryKey: ["pyq-paper-print", paper, year],
    enabled: !!paper && year !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const all: Question[] = [];
      let page = 1;
      // Bounded: a real paper is 150 questions at 20/page. The cap is a
      // runaway guard, not an expected limit — if it ever binds, the paper has
      // grown past 40 pages and something else is wrong.
      for (let guard = 0; guard < 40; guard++) {
        const res = await api.get("/api/v1/questions", questionsResponseSchema, {
          paper,
          year: year ?? undefined,
          page,
        });
        all.push(...res.items);
        if (page >= res.pagination.total_pages || res.items.length === 0) break;
        page += 1;
      }
      return all;
    },
  });
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params] = useSearchParams();
  const { label, isLoading: catalogLoading } = usePaperCatalog();

  const paper = params.get("paper") ?? "";
  const yearRaw = params.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;

  const { data, isLoading, isError, refetch } = useWholePaper(paper, year);

  const questions = data ?? [];
  const withKey = questions.filter((q) => q.correct_option_key);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <style>{`@media print {
        .pyq-noprint { display: none !important; }
        .pyq-shell { max-width: none !important; padding: 0 !important; }
        .pyq-q { break-inside: avoid; }
      }`}</style>

      <div className="pyq-noprint sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/${locale}/pyq-archive`}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("PyqArchive.backToArchive")}
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()} disabled={questions.length === 0}>
          <Printer className="size-4" aria-hidden />
          {t("PyqArchive.printAction")}
        </Button>
      </div>

      <main className="pyq-shell mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {!paper || year === null ? (
          <EmptyState
            icon={FileQuestion}
            title={t("PyqArchive.printMissingTitle")}
            description={t("PyqArchive.printMissingBody")}
          />
        ) : isError ? (
          <QueryErrorState onRetry={() => void refetch()} />
        ) : isLoading || catalogLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : questions.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title={t("PyqArchive.printEmptyTitle")}
            description={t("PyqArchive.printEmptyBody")}
          />
        ) : (
          <>
            <header className="mb-8 flex flex-col items-center gap-1 border-b-2 border-primary pb-6 text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {t("PyqArchive.printMasthead")}
              </span>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">{label(paper)}</h1>
              <p className="text-lg font-semibold text-foreground/80">{year}</p>
              <p className="text-sm text-muted-foreground">
                {t("PyqArchive.printCount", { count: questions.length })}
              </p>
            </header>

            <ol className="flex flex-col gap-5">
              {questions.map((q, i) => (
                <li key={q.id} className="pyq-q flex gap-3">
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-sm leading-relaxed whitespace-pre-line">
                      {formatQuestionStem(q.stem_i18n[locale] || q.stem_i18n.en)}
                    </p>
                    {q.options_i18n && (
                      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                        {q.options_i18n.map((o) => (
                          <li key={o.key} className="flex gap-2">
                            <span className="font-medium">({o.key})</span>
                            <span>{o.text_i18n[locale] || o.text_i18n.en}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.marks != null && (
                      <span className="text-xs text-muted-foreground">
                        {t("Learn.marks", { count: q.marks })}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {/* The key is a separate closing section rather than inline, so the
                paper above can be attempted as a real paper first. Only
                questions we actually hold a verified key for are listed — an
                absent entry is left absent rather than guessed. */}
            {withKey.length > 0 && (
              <section className="pyq-q mt-10 border-t-2 border-primary pt-6">
                <h2 className="mb-3 text-lg font-bold">{t("PyqArchive.printAnswerKey")}</h2>
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
                  {questions.map((q, i) =>
                    q.correct_option_key ? (
                      <li key={q.id}>
                        <span className="text-muted-foreground">{i + 1}.</span>{" "}
                        <span className="font-semibold">{q.correct_option_key}</span>
                      </li>
                    ) : null,
                  )}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("PyqArchive.printKeyNote", { withKey: withKey.length, total: questions.length })}
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
