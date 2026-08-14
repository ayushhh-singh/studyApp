import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import type { ExamCalendarEntry, PaperWeightage } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { useExams } from "@/hooks/use-exams";
import { useExamCalendar, usePaperWeightage } from "@/hooks/use-content-hub";
import { isAwaitingData } from "@/lib/query-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ExamPatternTable } from "@/components/content-hub/exam-pattern-table";
import type { ArticleHub } from "@/lib/articles";

/**
 * The live-data blocks an article interleaves with its prose.
 *
 * ⚑ WHY A MARKER RATHER THAN INTERPOLATION INTO THE MARKDOWN STRING. §5's rule
 * is that no date, count or percentage may be frozen into `en.json`/`hi.json` —
 * both files are large and shared, and a number frozen there is a number nobody
 * will remember to update. The tempting way to satisfy that is i18n
 * interpolation (`{{prelimsDate}}` inside `bodyMd`), and it is wrong here: an
 * interpolated value has to resolve to SOMETHING while the fetch is in flight
 * or after it fails, so the sentence around it either renders a placeholder
 * mid-paragraph or quietly states a fallback as fact. A block can do what a
 * sentence cannot — show a skeleton, show an error with a retry, or show
 * nothing — without ever putting a wrong number inside a claim.
 *
 * So prose asserts what does not drift (structure, process, what changed) and
 * blocks carry what does (dates, shares, counts). An author writes
 * `[[data:exam-timeline]]` on its own line; `article-detail.tsx` splits on it.
 *
 * Every block is FAIL-VISIBLE, never fail-quiet: a failed fetch renders
 * `QueryErrorState` with a retry rather than an empty div, because a silently
 * missing table reads to a reader as "this article has nothing to say here".
 */

/**
 * `[[data:<name>]]` — the marker's grammar. `weightage` takes a colon-separated
 * argument (`[[data:weightage:MAINS_GS5,MAINS_GS6]]`); the others take none.
 *
 * Kept deliberately narrow: an unknown marker renders NOTHING rather than
 * throwing, so a typo in a translation degrades to a missing block on one
 * locale instead of a white screen on a public marketing page.
 */
export function ArticleDataBlock({ marker, hub }: { marker: string; hub: ArticleHub }) {
  const [name, arg] = splitMarker(marker);
  if (name === "exam-timeline") return <ExamTimelineBlock hub={hub} />;
  if (name === "exam-pattern") return <ExamPatternBlock hub={hub} />;
  if (name === "weightage" && arg) return <WeightageBlock papers={arg.split(",").filter(Boolean)} />;
  return null;
}

function splitMarker(marker: string): [string, string | undefined] {
  const i = marker.indexOf(":");
  return i === -1 ? [marker, undefined] : [marker.slice(0, i), marker.slice(i + 1)];
}

// ---------------------------------------------------------------- timeline

function ExamTimelineBlock({ hub }: { hub: ArticleHub }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const calendar = useExamCalendar();

  if (calendar.isError) return <BlockShell><QueryErrorState onRetry={() => void calendar.refetch()} /></BlockShell>;
  if (isAwaitingData(calendar)) return <BlockShell><Skeleton /></BlockShell>;

  const rows = (calendar.data ?? []).filter((e) => e.exam_code === hub);
  if (rows.length === 0) {
    // The honest outcome, not a bug: UPPSC announces its Mains date only after
    // the Prelims result, so there is genuinely nothing to show for that stage
    // (migration 0126 records why no date was invented for it).
    return (
      <BlockShell>
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("Articles.data.timelineEmpty")}
        </p>
      </BlockShell>
    );
  }

  return (
    <BlockShell>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("Articles.data.timelineTitle")}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-4 py-3 font-semibold">{t("Articles.data.colMilestone")}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t("Articles.data.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TimelineRow key={`${row.exam_stage}-${row.exam_date}`} row={row} locale={locale} />
            ))}
          </tbody>
        </table>
      </div>
      {/* The commission's own provenance line, not ours. A reader who can see
          which notification a date came from is not relying on us to be fresh. */}
      {rows.some((r) => r.notes_i18n) && (
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          {rows
            .filter((r) => r.notes_i18n)
            .map((r) => (
              <li key={`note-${r.exam_stage}-${r.exam_date}`}>{r.notes_i18n?.[locale]}</li>
            ))}
        </ul>
      )}
    </BlockShell>
  );
}

function TimelineRow({ row, locale }: { row: ExamCalendarEntry; locale: "hi" | "en" }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border/60 last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden />
          {row.title_i18n[locale]}
        </span>
      </th>
      <td className="px-4 py-3">
        <time dateTime={row.exam_date} className="font-semibold">
          {formatLongDate(row.exam_date, locale)}
        </time>
        {row.is_tentative && (
          <span className="ms-2 rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-semibold text-marigold-foreground">
            {t("Articles.data.tentative")}
          </span>
        )}
      </td>
    </tr>
  );
}

// ----------------------------------------------------------------- pattern

function ExamPatternBlock({ hub }: { hub: ArticleHub }) {
  const { t } = useTranslation();
  const exams = useExams();
  if (exams.isError) return <BlockShell><QueryErrorState onRetry={() => void exams.refetch()} /></BlockShell>;
  if (isAwaitingData(exams)) return <BlockShell><Skeleton /></BlockShell>;
  const exam = exams.data?.find((e) => e.exam_code === hub);
  if (!exam) {
    return (
      <BlockShell>
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("Articles.hub.patternUnavailable")}
        </p>
      </BlockShell>
    );
  }
  return <BlockShell><ExamPatternTable exam={exam} /></BlockShell>;
}

// --------------------------------------------------------------- weightage

function WeightageBlock({ papers }: { papers: string[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const weightage = usePaperWeightage(papers);

  if (weightage.isError) return <BlockShell><QueryErrorState onRetry={() => void weightage.refetch()} /></BlockShell>;
  if (isAwaitingData(weightage)) return <BlockShell><Skeleton /></BlockShell>;

  const data = weightage.data ?? [];
  if (data.length === 0) return null;

  // Requested order, not response order — an article argues in a deliberate
  // sequence and must not be re-ordered by however the API grouped its rows.
  const ordered = papers.map((p) => data.find((d) => d.paper_code === p)).filter((d): d is PaperWeightage => Boolean(d));

  return (
    <BlockShell>
      <div className="space-y-6">
        {ordered.map((paper) => (
          <WeightageTable key={paper.paper_code} paper={paper} locale={locale} />
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("Articles.data.weightageSource")}</p>
    </BlockShell>
  );
}

function WeightageTable({ paper, locale }: { paper: PaperWeightage; locale: "hi" | "en" }) {
  const { t } = useTranslation();
  const span =
    paper.years.length > 0 ? `${paper.years[0]}–${paper.years[paper.years.length - 1]}` : "";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <h3 className="text-sm font-bold">{t(`Articles.data.paper.${paper.paper_code}`, paper.paper_code)}</h3>
        {/* Coverage is DERIVED, never asserted. `years.length` is the count of
            years that actually carry questions, so a gap in the bank (§2b: UPPSC
            Prelims GS-I 2022 is ingested but effectively unpublished) shows up
            here as "7 years, 2018-2025" on its own rather than depending on
            somebody remembering to write the caveat. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("Articles.data.weightageCoverage", {
            count: paper.years.length,
            span,
            total: paper.total_questions,
          })}
        </p>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("Articles.data.colSection")}</th>
            <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t("Articles.data.colAsked")}</th>
            <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t("Articles.data.colShare")}</th>
          </tr>
        </thead>
        <tbody>
          {paper.sections.map((s) => (
            <tr key={s.node_id} className="border-b border-border/60 last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-medium">
                {s.title_i18n[locale]}
              </th>
              <td className="px-4 py-2.5 text-end tabular-nums">{s.total}</td>
              <td className="px-4 py-2.5 text-end tabular-nums font-semibold">{s.share_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ shared

/** Consistent vertical rhythm between prose and a block, in one place. */
function BlockShell({ children }: { children: React.ReactNode }) {
  return <div className="my-8 not-prose">{children}</div>;
}

function Skeleton() {
  return <div className="h-44 animate-pulse rounded-2xl border border-border bg-card" aria-hidden />;
}

/** Locale-aware; `timeZone: "UTC"` so a date-only value cannot shift a day. */
function formatLongDate(iso: string, locale: "hi" | "en"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
