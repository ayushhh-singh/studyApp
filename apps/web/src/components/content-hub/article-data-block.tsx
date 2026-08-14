import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import type { ExamCalendarEntry, PaperWeightage } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { useExams } from "@/hooks/use-exams";
import { useExamCalendar, usePaperWeightage } from "@/hooks/use-content-hub";
import { isAwaitingData } from "@/lib/query-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ExamPatternTable } from "@/components/content-hub/exam-pattern-table";
import { booksForExam } from "@/lib/booklist";
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
  if (name === "marks-split") return <MarksSplitBlock hub={hub} />;
  if (name === "weightage" && arg) return <WeightageBlock papers={arg.split(",").filter(Boolean)} />;
  if (name === "booklist") return <BooklistBlock exam={hub} />;
  if (name === "reform-split" && arg) {
    const [year, papers] = splitMarker(arg);
    const pivot = Number(year);
    if (Number.isFinite(pivot) && papers) {
      return <ReformSplitBlock pivotYear={pivot} papers={papers.split(",").filter(Boolean)} />;
    }
  }
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

// ------------------------------------------------------------- marks split

/**
 * Where an exam's marks actually sit: what decides your rank, what only has to
 * be cleared, and what the interview carries.
 *
 * ⚑ EVERY FIGURE IS DERIVED FROM `paper_structure`, NOT WRITTEN. The insight
 * this block exists to deliver — that a large block of marks can end your
 * candidature while contributing nothing to your rank — is exactly the kind of
 * arithmetic that would otherwise be typed into a sentence and go stale the
 * next time a commission restructures. `counts_for_merit` is the registry's own
 * field; summing it here means the claim cannot drift from the pattern table
 * two sections above it.
 */
function MarksSplitBlock({ hub }: { hub: ArticleHub }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const exams = useExams();

  if (exams.isError) return <BlockShell><QueryErrorState onRetry={() => void exams.refetch()} /></BlockShell>;
  if (isAwaitingData(exams)) return <BlockShell><Skeleton /></BlockShell>;

  const exam = exams.data?.find((e) => e.exam_code === hub);
  if (!exam) return null;

  let merit = 0;
  let qualifying = 0;
  let interview = 0;
  const meritPapers: { label: string; marks: number }[] = [];

  for (const stage of exam.paper_structure.stages) {
    if (stage.stage === "interview") {
      interview += stage.marks ?? 0;
      continue;
    }
    // ⚑ ONLY MERIT-BEARING STAGES. An earlier cut summed every qualifying paper
    // in the exam and reported 800 for UPSC — folding Prelims CSAT (200) in with
    // the two Mains language papers (600). That mixes two universes: the total
    // this is read against is the MERIT total, which Prelims does not enter at
    // all, so a screening-stage paper has no place in "marks you sit for that do
    // not count toward your rank". Prelims is a separate stage with its own
    // arithmetic, and the pattern table above already shows it.
    if (!stage.counts_for_merit) continue;
    for (const paper of stage.papers ?? []) {
      const marks = paper.marks ?? 0;
      if (paper.counts_for_merit) {
        merit += marks;
        meritPapers.push({ label: paper.name_i18n[locale], marks });
      } else if (paper.minimum) {
        // Only a paper with a real threshold is "qualifying". A paper with no
        // minimum that does not count for merit is a screening paper — a third
        // thing again, and the distinction the pattern table now draws too.
        qualifying += marks;
      }
    }
  }

  const total = merit + interview;
  if (total === 0) return null;

  const rows = [
    { key: "merit", value: merit, share: Math.round((merit / total) * 1000) / 10 },
    { key: "interview", value: interview, share: Math.round((interview / total) * 1000) / 10 },
  ];

  return (
    <BlockShell>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold">{t("Articles.data.marksTitle")}</h3>
        <dl className="mt-4 space-y-3">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{t(`Articles.data.marks_${r.key}`)}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {r.value} <span className="text-xs font-normal text-muted-foreground">({r.share}%)</span>
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <dt className="text-sm font-semibold">{t("Articles.data.marks_total")}</dt>
            <dd className="text-sm font-bold tabular-nums">{total}</dd>
          </div>
          {qualifying > 0 && (
            <div className="flex items-baseline justify-between gap-4 rounded-xl bg-marigold/10 px-3 py-2.5">
              <dt className="text-sm font-medium text-marigold-foreground">{t("Articles.data.marks_qualifying")}</dt>
              <dd className="text-sm font-bold tabular-nums text-marigold-foreground">{qualifying}</dd>
            </div>
          )}
        </dl>
        {meritPapers.length > 0 && (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {t("Articles.data.marksMeritNote", { count: meritPapers.length, marks: merit })}
          </p>
        )}
      </div>
    </BlockShell>
  );
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

// ---------------------------------------------------------------- booklist

/**
 * The reference books for this exam — REVIEW ONLY, publisher page only (§7).
 *
 * ⚑ THE ONLY LINK A BOOK GETS IS ITS PUBLISHER'S OWN PRODUCT PAGE, and that is
 * enforced by the data rather than by care here: no type in `lib/booklist.ts`
 * carries a download field, so there is nothing else this component could
 * render even if someone wanted it to. Every title is in copyright and every
 * "free PDF" site an aspirant finds is distributing a pirated copy of one of
 * exactly these.
 *
 * Not fetched — this is verified reference data with no API behind it, so
 * unlike every other block on this page it DOES survive prerendering and a
 * crawler sees the whole list.
 */
function BooklistBlock({ exam }: { exam: ArticleHub }) {
  const { t } = useTranslation();
  const books = booksForExam(exam);
  if (books.length === 0) return null;

  return (
    <BlockShell>
      <div className="space-y-3">
        {books.map((book) => (
          <div key={book.isbn} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                {t(`Booklist.subject.${book.subjectKey}`)}
              </span>
            </div>
            <h3 className="mt-1.5 text-base font-bold tracking-tight">{book.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {book.author ? `${book.author} · ` : ""}
              {book.publisher}
            </p>
            <p className="mt-2 text-sm leading-relaxed">{t(`Booklist.note.${book.noteKey}`)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span>ISBN {book.isbn}</span>
              {book.priceInr !== null && <span>{t("Booklist.mrp", { price: book.priceInr })}</span>}
              <a
                href={book.publisherUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t("Booklist.publisherPage")}
              </a>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("Booklist.verifiedNote")}</p>
    </BlockShell>
  );
}

// ------------------------------------------------------------ reform split

/**
 * A paper's sections either side of a pivot year — what a restructure actually
 * changed, measured rather than asserted.
 *
 * ⚑ COMPARES PER-YEAR RATES, NOT RAW TOTALS, and that is the whole reason this
 * is a block instead of a sentence. The two windows are different lengths (five
 * years before the 2023 UPPSC reform, three after), so raw counts would make
 * every section look like it shrank. Dividing by the number of years ACTUALLY
 * PRESENT in the data on each side — not by the nominal window width — also
 * keeps it honest where a year is missing from the bank entirely.
 */
function ReformSplitBlock({ pivotYear, papers }: { pivotYear: number; papers: string[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const weightage = usePaperWeightage(papers);

  if (weightage.isError) return <BlockShell><QueryErrorState onRetry={() => void weightage.refetch()} /></BlockShell>;
  if (isAwaitingData(weightage)) return <BlockShell><Skeleton /></BlockShell>;

  const data = weightage.data ?? [];
  const ordered = papers.map((p) => data.find((d) => d.paper_code === p)).filter((d): d is PaperWeightage => Boolean(d));
  if (ordered.length === 0) return null;

  return (
    <BlockShell>
      <div className="space-y-6">
        {ordered.map((paper) => {
          const beforeYears = paper.years.filter((y) => y < pivotYear);
          const afterYears = paper.years.filter((y) => y >= pivotYear);
          const rate = (byYear: Record<string, number>, years: number[]) => {
            if (years.length === 0) return null;
            const sum = years.reduce((a, y) => a + (byYear[String(y)] ?? 0), 0);
            return Math.round((sum / years.length) * 10) / 10;
          };
          return (
            <div key={paper.paper_code} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border bg-muted/40 px-4 py-3">
                <h3 className="text-sm font-bold">{t(`Articles.data.paper.${paper.paper_code}`, paper.paper_code)}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("Articles.data.reformCoverage", {
                    beforeCount: beforeYears.length,
                    afterCount: afterYears.length,
                    pivot: pivotYear,
                  })}
                </p>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t("Articles.data.colSection")}</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t("Articles.data.colBefore", { pivot: pivotYear })}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t("Articles.data.colAfter", { pivot: pivotYear })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paper.sections.map((s) => {
                    const before = rate(s.by_year, beforeYears);
                    const after = rate(s.by_year, afterYears);
                    return (
                      <tr key={s.node_id} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium">{s.title_i18n[locale]}</th>
                        <td className="px-4 py-2.5 text-end tabular-nums text-muted-foreground">{before ?? "—"}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums font-semibold">{after ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("Articles.data.reformNote")}</p>
    </BlockShell>
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
