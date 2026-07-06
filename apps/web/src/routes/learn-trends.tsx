import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, BarChart3, Flame, Moon, TrendingUp } from "lucide-react";
import type { ExamCode, TrendNode } from "@prayasup/shared";
import { examCodeSchema } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamFilter } from "@/components/ui-x/exam-filter";
import { Button } from "@/components/ui/button";
import { usePaperTree, usePaperTrends } from "@/hooks/use-paper-tree";
import { useLocale } from "@/hooks/use-locale";
import type { Locale } from "@prayasup/shared";

export const handle = { titleKey: "Nav.learn" };

/** A single topic row: title + a frequency bar (normalised to the list's busiest) + terse stats. */
function TrendRow({ node, max, locale }: { node: TrendNode; max: number; locale: Locale }) {
  const { t } = useTranslation();
  const width = max > 0 ? Math.max(6, Math.round((node.total / max) * 100)) : 0;
  const hot = node.hotness >= 60;
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm">{node.title_i18n[locale]}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {hot && <Flame className="size-3 text-coral" aria-hidden />}
          {t("Learn.askedTimes", { count: node.total })}
          {node.last_asked_year != null && (
            <span className="opacity-70">· {t("Learn.lastAsked", { year: node.last_asked_year })}</span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

function TrendList({ nodes, locale }: { nodes: TrendNode[]; locale: Locale }) {
  const max = nodes.reduce((m, n) => Math.max(m, n.total), 0);
  return (
    <ul className="flex flex-col gap-2">
      {nodes.map((node) => (
        <TrendRow key={node.node_id} node={node} max={max} locale={locale} />
      ))}
    </ul>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { paperCode = "" } = useParams<{ paperCode: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const examParam = examCodeSchema.safeParse(searchParams.get("exam"));
  const exam: ExamCode | undefined = examParam.success ? examParam.data : undefined;
  const { data: trends, isLoading, isError } = usePaperTrends(paperCode, exam);
  const { data: tree } = usePaperTree(paperCode, exam);

  function setExam(next: ExamCode | undefined) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set("exam", next);
        else params.delete("exam");
        return params;
      },
      { replace: true },
    );
  }

  const paperTitle = tree ? tree.title_i18n[locale] : paperCode;

  const chartData =
    trends?.years.map((year) => ({ year: String(year), count: trends.total_by_year[String(year)] ?? 0 })) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("Nav.learn"), to: `/${locale}/learn` },
          { label: paperTitle, to: `/${locale}/learn/${paperCode}` },
          { label: t("Trends.title") },
        ]}
      />
      <PageHeader
        title={t("Trends.title")}
        description={t("Trends.description")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExamFilter value={exam} onChange={setExam} />
            <Button asChild variant="outline" size="sm">
              <Link to={`/${locale}/learn/${paperCode}${exam ? `?exam=${exam}` : ""}`}>
                <ArrowLeft aria-hidden />
                {t("Trends.backToPaper")}
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading || !trends ? (
        isError ? (
          <EmptyState icon={BarChart3} title={t("Trends.notFoundTitle")} description={t("Trends.notFoundDescription")} />
        ) : (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        )
      ) : trends.total_questions === 0 ? (
        <EmptyState icon={BarChart3} title={t("Trends.emptyTitle")} description={t("Trends.emptyDescription")} />
      ) : (
        <>
          <SectionCard title={t("Trends.perYearTitle")}>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {t("Trends.totalQuestions", { count: trends.total_questions })}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--accent)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chartData.map((d) => (
                      <Cell key={d.year} fill="var(--chart-4)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title={t("Trends.topTopicsTitle")}>
            {trends.top_nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Trends.emptyTitle")}</p>
            ) : (
              <TrendList nodes={trends.top_nodes} locale={locale} />
            )}
          </SectionCard>

          {trends.rising.length > 0 && (
            <SectionCard
              title={
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="size-4 text-tulsi" aria-hidden />
                  {t("Trends.risingTitle")}
                </span>
              }
              description={t("Trends.risingHint")}
            >
              <TrendList nodes={trends.rising} locale={locale} />
            </SectionCard>
          )}

          {trends.dormant.length > 0 && (
            <SectionCard
              title={
                <span className="flex items-center gap-1.5">
                  <Moon className="size-4 text-marigold" aria-hidden />
                  {t("Trends.dormantTitle")}
                </span>
              }
              description={t("Trends.dormantHint")}
            >
              <TrendList nodes={trends.dormant} locale={locale} />
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
