import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, FileText, ListChecks } from "lucide-react";
import type { PaperSummary } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";

export const handle = { titleKey: "Nav.learn" };

function PaperCard({ paper }: { paper: PaperSummary }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <Link
      to={`/${locale}/learn/${paper.paper_code}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BookOpen className="size-4" aria-hidden />
        </span>
        {paper.accuracy_pct !== null && (
          <span
            className="shrink-0 text-sm font-semibold tabular-nums"
            style={{ color: scoreBandColor(paper.accuracy_pct) }}
          >
            {Math.round(paper.accuracy_pct)}%
          </span>
        )}
      </div>
      <span className="text-sm font-semibold text-balance">{paper.title_i18n[locale]}</span>
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t("Learn.topicsCount", { count: paper.topics_count })}</span>
          <span className="flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden />
            {t("Learn.pyqCount", { count: paper.pyq_count })}
          </span>
        </div>
        <NotesCoverage published={paper.notes_published_count} topics={paper.topics_count} />
      </div>
    </Link>
  );
}

function NotesCoverage({ published, topics }: { published: number; topics: number }) {
  const { t } = useTranslation();
  const pct = topics > 0 ? Math.min(100, Math.round((published / topics) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {t("Learn.notesCoverage", { pct })}
      </span>
    </div>
  );
}

function PaperGroup({ title, papers }: { title: string; papers: PaperSummary[] }) {
  if (papers.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {papers.map((paper) => (
          <PaperCard key={paper.paper_code} paper={paper} />
        ))}
      </div>
    </section>
  );
}

export function Component() {
  const { t } = useTranslation();
  const { data, isLoading } = usePaperSummaries();

  const grouped = useMemo(() => {
    if (!data) return { prelims: [] as PaperSummary[], mains: [] as PaperSummary[] };
    return {
      prelims: data.filter((paper) => paper.exam_stage === "prelims"),
      mains: data.filter((paper) => paper.exam_stage === "mains"),
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Learn.title")} description={t("Learn.description")} tourAnchor="learn" />

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon={BookOpen} title={t("Learn.emptyTitle")} description={t("Learn.emptyDescription")} />
      ) : (
        <>
          <PaperGroup title={t("Learn.prelims")} papers={grouped.prelims} />
          <PaperGroup title={t("Learn.mains")} papers={grouped.mains} />
        </>
      )}
    </div>
  );
}
